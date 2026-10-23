/**
 * Loads one league's world (rules, settings, rosters, free agents,
 * projections) and values every relevant player under that league's scoring.
 * Everything here is scoped to a single league.
 */
import { and, desc, eq, gte, inArray, lte, max, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getActiveRules } from "./rules";
import { DEFAULT_RULES, type LeagueRules } from "../rules/schema";
import { blendWindows, playProbability, DEFAULT_WEIGHTS, type Windows, type WindowWeights } from "../engine/projections";
import { buildCategoryScorer, pointsValue, round } from "../engine/values";
import { EMPTY_LINE, type StatLine } from "../stats";
import { addDays, daysBetween, today, weekRange } from "../dates";

export interface ModelPlayer {
  id: number;
  name: string;
  positions: string[];
  nbaTeamId: number | null;
  teamAbbr: string | null;
  yahooStatus: string | null;
  injuryStatus: string | null;
  headshotUrl: string | null;
  playProbability: number;
  line: StatLine; // blended per-game projection
  hasProjection: boolean;
  valuePerGame: number;
  categoryZ: Record<string, number>;
  gamesRemainingSeason: number;
}

export interface RosterSpot {
  playerId: number;
  fantasyTeamId: number;
  slot: string;
}

export interface LeagueContext {
  league: typeof schema.leagues.$inferSelect;
  rules: LeagueRules;
  rulesVersion: number | null;
  settings: { windowWeights: WindowWeights; puntCategories: string[]; dropMargin: number; matchupAware: boolean };
  teams: (typeof schema.fantasyTeams.$inferSelect)[];
  myTeam: (typeof schema.fantasyTeams.$inferSelect) | null;
  rosterDate: string | null;
  roster: RosterSpot[]; // every team's roster on rosterDate
  freeAgents: { playerId: number; status: string; percentOwned: number | null; yahooRank: number | null }[];
  players: Map<number, ModelPlayer>;
  date: string;
}

export async function getLeagueSettings(leagueId: number) {
  const [row] = await getDb()
    .select()
    .from(schema.leagueSettings)
    .where(eq(schema.leagueSettings.leagueId, leagueId));
  return {
    windowWeights: row?.windowWeights ?? DEFAULT_WEIGHTS,
    puntCategories: row?.puntCategories ?? [],
    dropMargin: row?.dropMargin ?? 0.5,
    matchupAware: row?.matchupAware ?? true,
  };
}

export async function loadLeagueContext(
  leagueId: number,
  opts: { date?: string; categoryWeights?: Partial<Record<string, number>> } = {},
): Promise<LeagueContext> {
  const db = getDb();
  const date = opts.date ?? today();
  const [league] = await db.select().from(schema.leagues).where(eq(schema.leagues.id, leagueId));
  if (!league) throw new Error(`League ${leagueId} not found`);
  const active = await getActiveRules(leagueId);
  const rules = active?.rules ?? DEFAULT_RULES;
  const settings = await getLeagueSettings(leagueId);
  const teams = await db.select().from(schema.fantasyTeams).where(eq(schema.fantasyTeams.leagueId, leagueId));
  const myTeam = teams.find((t) => t.isMine) ?? null;

  // Most recent roster on or before the date (future days reuse today's roster).
  const [{ rosterDate }] = await db
    .select({ rosterDate: max(schema.rosterEntries.date) })
    .from(schema.rosterEntries)
    .where(and(eq(schema.rosterEntries.leagueId, leagueId), lte(schema.rosterEntries.date, date)));
  const roster = rosterDate
    ? await db
        .select({
          playerId: schema.rosterEntries.playerId,
          fantasyTeamId: schema.rosterEntries.fantasyTeamId,
          slot: schema.rosterEntries.slot,
        })
        .from(schema.rosterEntries)
        .where(and(eq(schema.rosterEntries.leagueId, leagueId), eq(schema.rosterEntries.date, rosterDate)))
    : [];

  const [{ takenAt }] = await db
    .select({ takenAt: max(schema.freeAgentSnapshots.takenAt) })
    .from(schema.freeAgentSnapshots)
    .where(eq(schema.freeAgentSnapshots.leagueId, leagueId));
  const rosteredIds = new Set(roster.map((r) => r.playerId));
  let freeAgents: LeagueContext["freeAgents"] = [];
  if (league.source === "manual") {
    freeAgents = await manualFreeAgents(rosteredIds);
  } else if (takenAt) {
    freeAgents = (
      await db
        .select({
          playerId: schema.freeAgentSnapshots.playerId,
          status: schema.freeAgentSnapshots.status,
          percentOwned: schema.freeAgentSnapshots.percentOwned,
          yahooRank: schema.freeAgentSnapshots.yahooRank,
        })
        .from(schema.freeAgentSnapshots)
        .where(and(eq(schema.freeAgentSnapshots.leagueId, leagueId), eq(schema.freeAgentSnapshots.takenAt, new Date(takenAt))))
    ).filter((f) => !rosteredIds.has(f.playerId));
  }

  const ids = [...new Set([...roster.map((r) => r.playerId), ...freeAgents.map((f) => f.playerId)])];
  const players = await valuePlayers(ids, rosteredIds, rules, settings, date, opts.categoryWeights);

  return {
    league,
    rules,
    rulesVersion: active?.version ?? null,
    settings,
    teams,
    myTeam,
    rosterDate: rosterDate ?? null,
    roster,
    freeAgents,
    players,
    date,
  };
}

/** Manual leagues have no free agent list: every active player with a projection who is on no team. */
async function manualFreeAgents(rosteredIds: Set<number>): Promise<LeagueContext["freeAgents"]> {
  const db = getDb();
  const [{ asOf }] = await db.select({ asOf: max(schema.playerProjections.asOfDate) }).from(schema.playerProjections);
  if (!asOf) return [];
  const rows = await db
    .selectDistinct({ playerId: schema.playerProjections.playerId })
    .from(schema.playerProjections)
    .innerJoin(schema.players, eq(schema.players.id, schema.playerProjections.playerId))
    .where(and(eq(schema.playerProjections.asOfDate, asOf), eq(schema.players.isActive, true)));
  return rows
    .filter((r) => !rosteredIds.has(r.playerId))
    .map((r) => ({ playerId: r.playerId, status: "FA", percentOwned: null, yahooRank: null }));
}

/** Blends projections with the league's window weights and values each player. */
async function valuePlayers(
  ids: number[],
  poolIds: Set<number>,
  rules: LeagueRules,
  settings: LeagueContext["settings"],
  date: string,
  categoryWeights?: Partial<Record<string, number>>,
): Promise<Map<number, ModelPlayer>> {
  const db = getDb();
  const out = new Map<number, ModelPlayer>();
  if (ids.length === 0) return out;

  const info = await db
    .select({
      id: schema.players.id,
      name: schema.players.fullName,
      positions: schema.players.eligiblePositions,
      nbaTeamId: schema.players.nbaTeamId,
      teamAbbr: schema.nbaTeams.abbreviation,
      yahooStatus: schema.players.yahooStatus,
      headshotUrl: schema.players.headshotUrl,
      injury: schema.playerInjuries.status,
    })
    .from(schema.players)
    .leftJoin(schema.nbaTeams, eq(schema.nbaTeams.id, schema.players.nbaTeamId))
    .leftJoin(schema.playerInjuries, eq(schema.playerInjuries.playerId, schema.players.id))
    .where(inArray(schema.players.id, ids));

  const [{ asOf }] = await db
    .select({ asOf: max(schema.playerProjections.asOfDate) })
    .from(schema.playerProjections)
    .where(lte(schema.playerProjections.asOfDate, date));
  const projRows = asOf
    ? await db
        .select()
        .from(schema.playerProjections)
        .where(and(eq(schema.playerProjections.asOfDate, asOf), inArray(schema.playerProjections.playerId, ids)))
    : [];
  const windows = new Map<number, Windows & { remaining: number }>();
  for (const r of projRows) {
    const w = windows.get(r.playerId) ?? {
      season: { games: 0, line: { ...EMPTY_LINE } },
      last14: { games: 0, line: { ...EMPTY_LINE } },
      last7: { games: 0, line: { ...EMPTY_LINE } },
      remaining: r.gamesRemaining,
    };
    const { gamesInWindow, ...rest } = r;
    const line = { ...EMPTY_LINE };
    for (const k of Object.keys(EMPTY_LINE) as (keyof StatLine)[]) line[k] = rest[k];
    w[r.horizon] = { games: gamesInWindow, line };
    windows.set(r.playerId, w);
  }

  for (const p of info) {
    const w = windows.get(p.id);
    const line = w ? blendWindows(w, settings.windowWeights) : { ...EMPTY_LINE };
    out.set(p.id, {
      id: p.id,
      name: p.name,
      positions: p.positions,
      nbaTeamId: p.nbaTeamId,
      teamAbbr: p.teamAbbr ?? null,
      yahooStatus: p.yahooStatus,
      injuryStatus: p.injury ?? null,
      headshotUrl: p.headshotUrl,
      playProbability: Math.min(playProbability(p.yahooStatus), playProbability(p.injury)),
      line,
      hasProjection: !!w && w.season.games > 0,
      valuePerGame: 0,
      categoryZ: {},
      gamesRemainingSeason: w?.remaining ?? 0,
    });
  }

  if (rules.scoring_type === "h2h_points") {
    for (const p of out.values()) p.valuePerGame = round(pointsValue(p.line, rules.point_weights), 2);
  } else {
    // z-scores against the league's rostered players; fall back to everyone projected.
    let pool = [...out.values()].filter((p) => poolIds.has(p.id) && p.hasProjection).map((p) => p.line);
    if (pool.length < 40) pool = [...out.values()].filter((p) => p.hasProjection).map((p) => p.line);
    const scorer = buildCategoryScorer(pool, rules.categories, {
      punt: settings.puntCategories,
      weights: categoryWeights,
      custom: rules.custom_stats,
    });
    for (const p of out.values()) {
      if (!p.hasProjection) continue;
      const s = scorer(p.line);
      p.valuePerGame = round(s.total, 2);
      p.categoryZ = s.z;
    }
  }
  return out;
}

/** NBA team ids with a game on each day. */
export async function teamsPlayingByDay(days: string[]): Promise<Map<string, Map<number, GameInfo>>> {
  const out = new Map<string, Map<number, GameInfo>>(days.map((d) => [d, new Map()]));
  if (days.length === 0) return out;
  const games = await getDb()
    .select()
    .from(schema.nbaGames)
    .where(and(gte(schema.nbaGames.gameDate, days[0]), lte(schema.nbaGames.gameDate, days[days.length - 1])));
  const teams = await getDb().select().from(schema.nbaTeams);
  const abbr = new Map(teams.map((t) => [t.id, t.abbreviation]));
  for (const g of games) {
    const day = out.get(g.gameDate);
    if (!day) continue;
    day.set(g.homeTeamId, { opponent: abbr.get(g.awayTeamId) ?? "?", home: true, tipTime: g.tipTime, status: g.status });
    day.set(g.awayTeamId, { opponent: abbr.get(g.homeTeamId) ?? "?", home: false, tipTime: g.tipTime, status: g.status });
  }
  return out;
}

export interface GameInfo {
  opponent: string;
  home: boolean;
  tipTime: Date | null;
  status: string;
}

export function currentWeek(ctx: LeagueContext, date = ctx.date) {
  const { start, end } = weekRange(date, ctx.rules.week_start_day);
  return { start, end, days: daysBetween(start, end), remainingDays: daysBetween(date > start ? date : start, end) };
}

/** Latest matchup row for my team in this league. */
export async function latestMatchup(leagueId: number, teamId: number) {
  const [m] = await getDb()
    .select()
    .from(schema.matchups)
    .where(and(eq(schema.matchups.leagueId, leagueId), eq(schema.matchups.teamId, teamId)))
    .orderBy(desc(schema.matchups.week))
    .limit(1);
  return m ?? null;
}

export async function lastSync(leagueId: number) {
  const [row] = await getDb()
    .select({ at: max(schema.syncRuns.finishedAt) })
    .from(schema.syncRuns)
    .where(and(or(eq(schema.syncRuns.leagueId, leagueId)), eq(schema.syncRuns.status, "ok")));
  return row?.at ?? null;
}

export { addDays };
