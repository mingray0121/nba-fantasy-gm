import { and, desc, eq, inArray, max } from "drizzle-orm";
import { getDb, schema } from "@/db";

/** Your leagues with scoring type and the last successful sync. */
export async function listLeagues(userId: number) {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.leagues.id,
      name: schema.leagues.name,
      source: schema.leagues.source,
      season: schema.leagues.season,
      numTeams: schema.leagues.numTeams,
      yahooLeagueKey: schema.leagues.yahooLeagueKey,
      isArchived: schema.leagues.isArchived,
      scoringType: schema.leagueRuleVersions.scoringType,
      ruleVersion: schema.leagueRuleVersions.version,
    })
    .from(schema.leagues)
    .leftJoin(schema.leagueRuleVersions, eq(schema.leagueRuleVersions.id, schema.leagues.activeRuleVersionId))
    .where(eq(schema.leagues.userId, userId))
    .orderBy(desc(schema.leagues.season), schema.leagues.name);
  if (rows.length === 0) return [];
  const syncs = await db
    .select({ leagueId: schema.syncRuns.leagueId, at: max(schema.syncRuns.finishedAt) })
    .from(schema.syncRuns)
    .where(and(inArray(schema.syncRuns.leagueId, rows.map((r) => r.id)), eq(schema.syncRuns.status, "ok")))
    .groupBy(schema.syncRuns.leagueId);
  const last = new Map(syncs.map((s) => [s.leagueId, s.at]));
  return rows.map((r) => ({ ...r, lastSyncAt: last.get(r.id) ?? null }));
}
