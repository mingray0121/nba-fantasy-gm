import { NextResponse, type NextRequest } from "next/server";
import { and, eq, ilike, inArray, lte, max } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { handler, requireLeague, requireUser } from "@/lib/api";
import { today } from "@/lib/dates";

/** Player search by name. With ?league=<id>, also says which team in that league has each player. */
export const GET = handler(async (req: NextRequest) => {
  await requireUser();
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ players: [] });
  const db = getDb();
  const found = await db
    .select({
      id: schema.players.id,
      name: schema.players.fullName,
      positions: schema.players.eligiblePositions,
      team: schema.nbaTeams.abbreviation,
      injury: schema.playerInjuries.status,
    })
    .from(schema.players)
    .leftJoin(schema.nbaTeams, eq(schema.nbaTeams.id, schema.players.nbaTeamId))
    .leftJoin(schema.playerInjuries, eq(schema.playerInjuries.playerId, schema.players.id))
    .where(and(ilike(schema.players.fullName, `%${q.replace(/[%_]/g, "")}%`), eq(schema.players.isActive, true)))
    .orderBy(schema.players.fullName)
    .limit(15);

  const leagueParam = req.nextUrl.searchParams.get("league");
  const owners = new Map<number, { teamId: number; teamName: string }>();
  if (leagueParam && found.length) {
    const league = await requireLeague(leagueParam);
    const [{ date }] = await db
      .select({ date: max(schema.rosterEntries.date) })
      .from(schema.rosterEntries)
      .where(and(eq(schema.rosterEntries.leagueId, league.id), lte(schema.rosterEntries.date, today())));
    if (date) {
      const rows = await db
        .select({ playerId: schema.rosterEntries.playerId, teamId: schema.fantasyTeams.id, teamName: schema.fantasyTeams.name })
        .from(schema.rosterEntries)
        .innerJoin(schema.fantasyTeams, eq(schema.fantasyTeams.id, schema.rosterEntries.fantasyTeamId))
        .where(
          and(
            eq(schema.rosterEntries.leagueId, league.id),
            eq(schema.rosterEntries.date, date),
            inArray(schema.rosterEntries.playerId, found.map((p) => p.id)),
          ),
        );
      for (const r of rows) owners.set(r.playerId, { teamId: r.teamId, teamName: r.teamName });
    }
  }
  return NextResponse.json({ players: found.map((p) => ({ ...p, owner: owners.get(p.id) ?? null })) });
});
