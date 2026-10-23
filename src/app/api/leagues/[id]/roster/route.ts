import { NextResponse, type NextRequest } from "next/server";
import { and, eq, lte, max } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { handler, HttpError, requireLeague } from "@/lib/api";
import { runJob } from "@/lib/jobs/registry";
import { today } from "@/lib/dates";
import { teamsPlayingByDay } from "@/lib/data/model";
import { applyTipOffLock, assertPlayersAvailable, replaceTeamRoster } from "@/lib/data/roster";

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
  const rows = date
    ? await db
        .select({
          playerId: schema.rosterEntries.playerId,
          slot: schema.rosterEntries.slot,
          name: schema.players.fullName,
          positions: schema.players.eligiblePositions,
          nbaTeamId: schema.players.nbaTeamId,
          team: schema.nbaTeams.abbreviation,
          injury: schema.playerInjuries.status,
        })
        .from(schema.rosterEntries)
        .innerJoin(schema.players, eq(schema.players.id, schema.rosterEntries.playerId))
        .leftJoin(schema.nbaTeams, eq(schema.nbaTeams.id, schema.players.nbaTeamId))
        .leftJoin(schema.playerInjuries, eq(schema.playerInjuries.playerId, schema.players.id))
        .where(and(eq(schema.rosterEntries.fantasyTeamId, team.id), eq(schema.rosterEntries.date, date)))
    : [];
  // Today's game for each player, like Yahoo's roster page.
  const day = today();
  const games = (await teamsPlayingByDay([day])).get(day)!;
  const players = rows.map(({ nbaTeamId, ...r }) => {
    const g = nbaTeamId ? games.get(nbaTeamId) : undefined;
    return { ...r, game: g ? { opponent: g.opponent, home: g.home, tipTime: g.tipTime?.toISOString() ?? null } : null };
  });
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
  await assertPlayersAvailable(league.id, team.id, players.map((p) => p.playerId));
  const db = getDb();
  for (const p of players) {
    if (p.positions?.length) {
      await db.update(schema.players).set({ eligiblePositions: p.positions }).where(eq(schema.players.id, p.playerId));
    }
  }
  const { players: toSave, locked } = await applyTipOffLock(team.id, players);
  await replaceTeamRoster(league.id, team.id, toSave);
  const runs = await runJob("values", league.id);
  return NextResponse.json({ ok: true, locked, runs });
});
