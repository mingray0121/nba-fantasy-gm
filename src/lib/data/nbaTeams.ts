/** NBA team rosters for one league: positions, injuries, season averages, value and fantasy owner. */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { loadLeagueContext } from "./model";

export async function nbaTeamsList() {
  return getDb()
    .select({ abbreviation: schema.nbaTeams.abbreviation, name: schema.nbaTeams.name })
    .from(schema.nbaTeams)
    .orderBy(asc(schema.nbaTeams.name));
}

export async function nbaTeamView(leagueId: number, abbreviation: string) {
  const db = getDb();
  const [team] = await db.select().from(schema.nbaTeams).where(eq(schema.nbaTeams.abbreviation, abbreviation.toUpperCase()));
  if (!team) return null;
  const players = await db
    .select({
      id: schema.players.id,
      name: schema.players.fullName,
      positions: schema.players.eligiblePositions,
      injury: schema.playerInjuries.status,
    })
    .from(schema.players)
    .leftJoin(schema.playerInjuries, eq(schema.playerInjuries.playerId, schema.players.id))
    .where(and(eq(schema.players.nbaTeamId, team.id), eq(schema.players.isActive, true)));
  const ids = players.map((p) => p.id);
  const avgs = ids.length
    ? await db
        .select({
          playerId: schema.playerGameLogs.playerId,
          gp: sql<number>`count(*) filter (where ${schema.playerGameLogs.minutes} > 0)::int`,
          min: sql<number>`coalesce(avg(${schema.playerGameLogs.minutes}) filter (where ${schema.playerGameLogs.minutes} > 0), 0)::float`,
          pts: sql<number>`coalesce(avg(${schema.playerGameLogs.pts}) filter (where ${schema.playerGameLogs.minutes} > 0), 0)::float`,
          reb: sql<number>`coalesce(avg(${schema.playerGameLogs.reb}) filter (where ${schema.playerGameLogs.minutes} > 0), 0)::float`,
          ast: sql<number>`coalesce(avg(${schema.playerGameLogs.ast}) filter (where ${schema.playerGameLogs.minutes} > 0), 0)::float`,
        })
        .from(schema.playerGameLogs)
        .where(inArray(schema.playerGameLogs.playerId, ids))
        .groupBy(schema.playerGameLogs.playerId)
    : [];
  const avgOf = new Map(avgs.map((a) => [a.playerId, a]));

  const ctx = await loadLeagueContext(leagueId);
  const ownerOf = new Map(ctx.roster.map((r) => [r.playerId, ctx.teams.find((t) => t.id === r.fantasyTeamId)?.name ?? null]));
  const rows = players.map((p) => {
    const a = avgOf.get(p.id);
    return {
      ...p,
      gp: a?.gp ?? 0,
      min: a?.min ?? 0,
      pts: a?.pts ?? 0,
      reb: a?.reb ?? 0,
      ast: a?.ast ?? 0,
      value: ctx.players.get(p.id)?.valuePerGame ?? null,
      owner: ownerOf.get(p.id) ?? null,
    };
  });
  rows.sort((x, y) => y.min - x.min || x.name.localeCompare(y.name));
  return { team: { abbreviation: team.abbreviation, name: team.name }, players: rows };
}
