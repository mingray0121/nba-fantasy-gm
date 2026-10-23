import { and, asc, desc, eq, max } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { RuleSource } from "@/db/schema";
import { isNegativeStat, type LeagueRules, type Slot } from "../rules/schema";
import { STAT_DISPLAY, type CustomStats, type StatKey } from "../stats";

export interface ActiveRules {
  versionId: number;
  version: number;
  source: RuleSource;
  createdAt: Date;
  rules: LeagueRules;
}

/** The league's active rule version, rebuilt from the rule tables. */
export async function getActiveRules(leagueId: number): Promise<ActiveRules | null> {
  const db = getDb();
  const [league] = await db
    .select({ active: schema.leagues.activeRuleVersionId })
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId));
  if (!league?.active) return null;
  return getRuleVersion(leagueId, league.active);
}

export async function getRuleVersion(leagueId: number, versionId: number): Promise<ActiveRules | null> {
  const db = getDb();
  const [v] = await db
    .select()
    .from(schema.leagueRuleVersions)
    .where(and(eq(schema.leagueRuleVersions.id, versionId), eq(schema.leagueRuleVersions.leagueId, leagueId)));
  if (!v) return null;
  const cats = await db
    .select()
    .from(schema.leagueStatCategories)
    .where(eq(schema.leagueStatCategories.ruleVersionId, v.id))
    .orderBy(asc(schema.leagueStatCategories.sortOrder));
  const slots = await db
    .select()
    .from(schema.leagueRosterSlots)
    .where(eq(schema.leagueRosterSlots.ruleVersionId, v.id));

  const isPoints = v.scoringType === "h2h_points";
  return {
    versionId: v.id,
    version: v.version,
    source: v.source,
    createdAt: v.createdAt,
    rules: {
      scoring_type: v.scoringType,
      categories: isPoints ? [] : cats.map((c) => c.statKey),
      custom_stats: isPoints ? {} : ((v.rulesRaw as { normalized?: { custom_stats?: CustomStats } }).normalized?.custom_stats ?? {}),
      point_weights: isPoints
        ? Object.fromEntries(cats.map((c) => [c.statKey, c.pointWeight ?? 0]))
        : {},
      roster_slots: Object.fromEntries(slots.map((s) => [s.slot, s.count])) as Partial<Record<Slot, number>>,
      games_played_limit: v.gamesPlayedLimit,
      max_adds_per_week: v.maxAddsPerWeek,
      week_start_day: v.weekStartDay,
    },
  };
}

export async function listRuleVersions(leagueId: number) {
  return getDb()
    .select({
      id: schema.leagueRuleVersions.id,
      version: schema.leagueRuleVersions.version,
      source: schema.leagueRuleVersions.source,
      scoringType: schema.leagueRuleVersions.scoringType,
      uploadedFileName: schema.leagueRuleVersions.uploadedFileName,
      createdAt: schema.leagueRuleVersions.createdAt,
    })
    .from(schema.leagueRuleVersions)
    .where(eq(schema.leagueRuleVersions.leagueId, leagueId))
    .orderBy(desc(schema.leagueRuleVersions.version));
}

/** Saves rules as a new version for this league only, and makes it active. */
export async function saveRuleVersion(
  leagueId: number,
  rules: LeagueRules,
  source: RuleSource,
  opts: { fileName?: string; raw?: unknown } = {},
): Promise<number> {
  return getDb().transaction(async (tx) => {
    const [{ current }] = await tx
      .select({ current: max(schema.leagueRuleVersions.version) })
      .from(schema.leagueRuleVersions)
      .where(eq(schema.leagueRuleVersions.leagueId, leagueId));
    const [v] = await tx
      .insert(schema.leagueRuleVersions)
      .values({
        leagueId,
        version: (current ?? 0) + 1,
        source,
        scoringType: rules.scoring_type,
        gamesPlayedLimit: rules.games_played_limit,
        maxAddsPerWeek: rules.max_adds_per_week,
        weekStartDay: rules.week_start_day,
        uploadedFileName: opts.fileName ?? null,
        rulesRaw: { normalized: rules, source: opts.raw ?? null },
      })
      .returning({ id: schema.leagueRuleVersions.id });

    const statRows =
      rules.scoring_type === "h2h_points"
        ? Object.entries(rules.point_weights).map(([k, w], i) => ({ key: k as StatKey, w, i }))
        : rules.categories.map((k, i) => ({ key: k, w: null as number | null, i }));
    if (statRows.length) {
      await tx.insert(schema.leagueStatCategories).values(
        statRows.map((r) => ({
          ruleVersionId: v.id,
          statKey: r.key,
          displayName: STAT_DISPLAY[r.key as StatKey] ?? r.key,
          isNegative: isNegativeStat(r.key, rules.custom_stats),
          pointWeight: r.w,
          sortOrder: r.i,
        })),
      );
    }
    const slotRows = Object.entries(rules.roster_slots).filter(([, c]) => (c ?? 0) > 0);
    if (slotRows.length) {
      await tx
        .insert(schema.leagueRosterSlots)
        .values(slotRows.map(([slot, count]) => ({ ruleVersionId: v.id, slot, count: count! })));
    }
    await tx
      .update(schema.leagues)
      .set({ activeRuleVersionId: v.id })
      .where(eq(schema.leagues.id, leagueId));
    return v.id;
  });
}

/** Points the league back at an earlier version (no new version is created). */
export async function activateRuleVersion(leagueId: number, versionId: number) {
  const found = await getRuleVersion(leagueId, versionId);
  if (!found) return false;
  await getDb()
    .update(schema.leagues)
    .set({ activeRuleVersionId: versionId })
    .where(eq(schema.leagues.id, leagueId));
  return true;
}

export function sameRules(a: LeagueRules, b: LeagueRules): boolean {
  const norm = (r: LeagueRules) =>
    JSON.stringify({
      ...r,
      categories: [...r.categories].sort(),
      point_weights: Object.fromEntries(Object.entries(r.point_weights).sort()),
      roster_slots: Object.fromEntries(Object.entries(r.roster_slots).filter(([, c]) => c).sort()),
    });
  return norm(a) === norm(b);
}
