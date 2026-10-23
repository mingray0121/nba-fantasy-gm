import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { handler, HttpError, requireLeague } from "@/lib/api";
import { applyTipOffLock, assertPlayersAvailable, assertValidSlots, canPlaySlot, currentTeamRoster, replaceTeamRoster } from "@/lib/data/roster";
import { getActiveRules } from "@/lib/data/rules";
import { runJob } from "@/lib/jobs/registry";
import { addDays, toLocalDate, today, weekRange } from "@/lib/dates";

type Ctx = { params: Promise<{ id: string }> };
type League = Awaited<ReturnType<typeof requireLeague>>;

/** Adds per team this week (weeks start on the league's week start day, US Eastern dates). */
async function weekUsage(league: League) {
  const rules = (await getActiveRules(league.id))?.rules;
  const week = weekRange(today(), rules?.week_start_day ?? 1);
  const rows = await getDb()
    .select({ teamId: schema.transactions.teamId, type: schema.transactions.type, happenedAt: schema.transactions.happenedAt })
    .from(schema.transactions)
    .where(and(eq(schema.transactions.leagueId, league.id), gte(schema.transactions.happenedAt, new Date(`${addDays(week.start, -1)}T00:00:00Z`))));
  const adds = new Map<number, number>();
  for (const r of rows) {
    const day = toLocalDate(r.happenedAt, "America/New_York");
    if (r.type !== "add" || r.teamId == null || day < week.start || day > week.end) continue;
    adds.set(r.teamId, (adds.get(r.teamId) ?? 0) + 1);
  }
  return { week, maxAdds: rules?.max_adds_per_week ?? null, adds };
}

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  const db = getDb();
  const { week, maxAdds, adds } = await weekUsage(league);
  const teams = await db
    .select({ id: schema.fantasyTeams.id, name: schema.fantasyTeams.name, isMine: schema.fantasyTeams.isMine })
    .from(schema.fantasyTeams)
    .where(eq(schema.fantasyTeams.leagueId, league.id))
    .orderBy(schema.fantasyTeams.id);
  const history = await db
    .select({
      id: schema.transactions.id,
      type: schema.transactions.type,
      happenedAt: schema.transactions.happenedAt,
      player: schema.players.fullName,
      team: schema.fantasyTeams.name,
    })
    .from(schema.transactions)
    .innerJoin(schema.players, eq(schema.players.id, schema.transactions.playerId))
    .leftJoin(schema.fantasyTeams, eq(schema.fantasyTeams.id, schema.transactions.teamId))
    .where(eq(schema.transactions.leagueId, league.id))
    .orderBy(desc(schema.transactions.happenedAt), desc(schema.transactions.id))
    .limit(50);
  return NextResponse.json({
    week,
    maxAdds,
    teams: teams.map((t) => ({ ...t, addsThisWeek: adds.get(t.id) ?? 0 })),
    history,
  });
});

const input = z
  .object({
    teamId: z.number().int(),
    addPlayerId: z.number().int().optional(),
    dropPlayerId: z.number().int().optional(),
  })
  .refine((v) => v.addPlayerId || v.dropPlayerId, "Pick a player to add or drop");

/** Manual leagues: record an add, a drop, or both, and update the team's roster. */
export const POST = handler(async (req: Request, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  if (league.source !== "manual") throw new HttpError(400, "Make moves for Yahoo leagues in Yahoo");
  const { teamId, addPlayerId, dropPlayerId } = input.parse(await req.json());
  const db = getDb();
  const [team] = await db
    .select()
    .from(schema.fantasyTeams)
    .where(and(eq(schema.fantasyTeams.id, teamId), eq(schema.fantasyTeams.leagueId, league.id)));
  if (!team) throw new HttpError(404, "Team not found");

  const roster = await currentTeamRoster(team.id);
  const dropped = dropPlayerId ? roster.find((r) => r.playerId === dropPlayerId) : undefined;
  if (dropPlayerId && !dropped) throw new HttpError(400, `That player isn't on ${team.name}`);
  if (addPlayerId) {
    if (roster.some((r) => r.playerId === addPlayerId)) throw new HttpError(400, `That player is already on ${team.name}`);
    await assertPlayersAvailable(league.id, team.id, [addPlayerId]);
    const { maxAdds, adds } = await weekUsage(league);
    const used = adds.get(team.id) ?? 0;
    if (maxAdds != null && used >= maxAdds) {
      throw new HttpError(400, `${team.name} has used all ${maxAdds} adds this week`);
    }
  }

  const next = roster.filter((r) => r.playerId !== dropPlayerId);
  // The new player takes the dropped player's slot when his positions fit it, else the bench.
  if (addPlayerId) {
    const [added] = await db
      .select({ positions: schema.players.eligiblePositions })
      .from(schema.players)
      .where(eq(schema.players.id, addPlayerId));
    const slot = dropped && canPlaySlot(dropped.slot, added?.positions ?? []) ? dropped.slot : "BN";
    next.push({ playerId: addPlayerId, slot });
  }
  await assertValidSlots(league.id, next);
  const { players: toSave, locked } = await applyTipOffLock(team.id, next);
  await replaceTeamRoster(league.id, team.id, toSave);

  const key = `manual:${randomUUID()}`;
  const happenedAt = new Date();
  const rows = [
    ...(dropPlayerId ? [{ type: "drop" as const, playerId: dropPlayerId }] : []),
    ...(addPlayerId ? [{ type: "add" as const, playerId: addPlayerId }] : []),
  ];
  await db
    .insert(schema.transactions)
    .values(rows.map((r) => ({ leagueId: league.id, yahooTransactionKey: key, teamId: team.id, happenedAt, ...r })));
  const runs = await runJob("values", league.id);
  return NextResponse.json({ ok: true, locked, runs }, { status: 201 });
});
