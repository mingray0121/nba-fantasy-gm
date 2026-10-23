import { NextResponse, type NextRequest } from "next/server";
import { and, eq, inArray, lte, max, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { handler, HttpError, requireLeague } from "@/lib/api";
import { runJob } from "@/lib/jobs/registry";
import { today } from "@/lib/dates";
import { normalizeSlot } from "@/lib/rules/schema";

type Ctx = { params: Promise<{ id: string }> };
type League = Awaited<ReturnType<typeof requireLeague>>;

async function findTeam(league: League, teamId: number | undefined) {
  const [team] = await getDb()
    .select()
    .from(schema.fantasyTeams)
    .where(
      and(
        eq(schema.fantasyTeams.leagueId, league.id),
        teamId ? eq(schema.fantasyTeams.id, teamId) : eq(schema.fantasyTeams.isMine, true),
      ),
    );
  if (!team) throw new HttpError(400, teamId ? "Team not found" : "This league has no team marked as yours");
  return team;
}

/** One team's latest roster (your team unless ?teamId=). */
export const GET = handler(async (req: NextRequest, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  const teamId = Number(req.nextUrl.searchParams.get("teamId")) || undefined;
  const team = await findTeam(league, teamId);
  const db = getDb();
  const [{ date }] = await db
    .select({ date: max(schema.rosterEntries.date) })
    .from(schema.rosterEntries)
    .where(and(eq(schema.rosterEntries.fantasyTeamId, team.id), lte(schema.rosterEntries.date, today())));
  const players = date
    ? await db
        .select({
          playerId: schema.rosterEntries.playerId,
          slot: schema.rosterEntries.slot,
          name: schema.players.fullName,
          positions: schema.players.eligiblePositions,
        })
        .from(schema.rosterEntries)
        .innerJoin(schema.players, eq(schema.players.id, schema.rosterEntries.playerId))
        .where(and(eq(schema.rosterEntries.fantasyTeamId, team.id), eq(schema.rosterEntries.date, date)))
    : [];
  return NextResponse.json({ team, players });
});

const input = z.object({
  teamId: z.number().int().optional(),
  players: z.array(z.object({ playerId: z.number().int(), slot: z.string(), positions: z.array(z.string()).optional() })).max(30),
});

/** Manual leagues: set a team's roster by hand (Yahoo leagues sync it automatically). */
export const PUT = handler(async (req: Request, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  if (league.source !== "manual") throw new HttpError(400, "Yahoo leagues sync their roster from Yahoo");
  const { teamId, players } = input.parse(await req.json());
  const team = await findTeam(league, teamId);
  const db = getDb();
  const date = today();
  for (const p of players) {
    if (p.positions?.length) {
      await db.update(schema.players).set({ eligiblePositions: p.positions }).where(eq(schema.players.id, p.playerId));
    }
  }
  if (players.length) {
    const found = await db.select({ id: schema.players.id }).from(schema.players).where(inArray(schema.players.id, players.map((p) => p.playerId)));
    if (found.length !== new Set(players.map((p) => p.playerId)).size) throw new HttpError(400, "Unknown player id");
    const taken = await db
      .select({ playerId: schema.rosterEntries.playerId, team: schema.fantasyTeams.name })
      .from(schema.rosterEntries)
      .innerJoin(schema.fantasyTeams, eq(schema.fantasyTeams.id, schema.rosterEntries.fantasyTeamId))
      .where(
        and(
          eq(schema.rosterEntries.leagueId, league.id),
          ne(schema.rosterEntries.fantasyTeamId, team.id),
          eq(schema.rosterEntries.date, await latestLeagueDate(league.id, date)),
          inArray(schema.rosterEntries.playerId, players.map((p) => p.playerId)),
        ),
      );
    if (taken.length) throw new HttpError(400, `Already on another team: ${taken.map((t) => `${t.team}`).join(", ")}`);
  }
  await db.transaction(async (tx) => {
    // The model reads every team's roster from the league's latest date, so bring
    // the other teams' latest rosters forward to today before replacing this one.
    const others = await tx
      .select({ id: schema.fantasyTeams.id })
      .from(schema.fantasyTeams)
      .where(and(eq(schema.fantasyTeams.leagueId, league.id), ne(schema.fantasyTeams.id, team.id)));
    for (const other of others) {
      const [{ latest }] = await tx
        .select({ latest: max(schema.rosterEntries.date) })
        .from(schema.rosterEntries)
        .where(and(eq(schema.rosterEntries.fantasyTeamId, other.id), lte(schema.rosterEntries.date, date)));
      if (!latest || latest === date) continue;
      const rows = await tx
        .select()
        .from(schema.rosterEntries)
        .where(and(eq(schema.rosterEntries.fantasyTeamId, other.id), eq(schema.rosterEntries.date, latest)));
      if (rows.length) {
        await tx.insert(schema.rosterEntries).values(rows.map(({ id: _id, ...r }) => ({ ...r, date })));
      }
    }
    await tx
      .delete(schema.rosterEntries)
      .where(and(eq(schema.rosterEntries.fantasyTeamId, team.id), eq(schema.rosterEntries.date, date)));
    if (players.length) {
      await tx.insert(schema.rosterEntries).values(
        players.map((p) => ({ leagueId: league.id, fantasyTeamId: team.id, playerId: p.playerId, date, slot: normalizeSlot(p.slot) ?? "BN" })),
      );
    }
  });
  const runs = await runJob("values", league.id);
  return NextResponse.json({ ok: true, runs });
});

async function latestLeagueDate(leagueId: number, onOrBefore: string): Promise<string> {
  const [{ latest }] = await getDb()
    .select({ latest: max(schema.rosterEntries.date) })
    .from(schema.rosterEntries)
    .where(and(eq(schema.rosterEntries.leagueId, leagueId), lte(schema.rosterEntries.date, onOrBefore)));
  return latest ?? onOrBefore;
}
