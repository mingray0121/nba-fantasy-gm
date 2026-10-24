/** Read models behind the pages. Each takes one league and computes from what the jobs stored. */
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  currentWeek,
  latestMatchup,
  loadLeagueContext,
  teamsPlayingByDay,
  type GameInfo,
  type LeagueContext,
  type ModelPlayer,
} from "./model";
import { optimizeLineup, type LineupPlayer } from "../engine/lineup";
import {
  matchupWeights,
  projectCategories,
  referenceStats,
  toDateInputs,
  type CategoryProjection,
  type ReferenceStat,
} from "../engine/matchup";
import { suggestAddDrops, type AddDropPlayer } from "../engine/addDrop";
import { computeWindows, blendWindows, DEFAULT_WEIGHTS } from "../engine/projections";
import { pointsValue, round } from "../engine/values";
import { ACTIVE_SLOTS, INJURED_SLOTS, type Slot } from "../rules/schema";
import { addLines, COUNTING_STATS, EMPTY_LINE, scaleLine, type CountingStatKey, type StatLine } from "../stats";
import { addDays, today } from "../dates";

/* ------------------------------------------------------------------ */
/* Today: start / bench                                                */
/* ------------------------------------------------------------------ */

export interface LineupRow {
  playerId: number;
  name: string;
  positions: string[];
  team: string | null;
  status: string | null;
  game: (Omit<GameInfo, "tipTime"> & { tipTime: string | null }) | null;
  currentSlot: string;
  recommendedSlot: string;
  value: number;
  valuePerGame: number;
  action: "start" | "bench" | "keep";
  reason: string;
}

function rosterFor(ctx: LeagueContext, teamId: number | undefined) {
  return ctx.roster.filter((r) => r.fantasyTeamId === teamId);
}

function lineupPlayers(
  ctx: LeagueContext,
  teamId: number,
  games: Map<number, GameInfo>,
  useStatus: boolean,
): LineupPlayer[] {
  return rosterFor(ctx, teamId).map((r) => {
    const p = ctx.players.get(r.playerId);
    const hasGame = !!p?.nbaTeamId && games.has(p.nbaTeamId);
    const prob = useStatus ? (p?.playProbability ?? 1) : p?.playProbability === 0 ? 0 : 1;
    return {
      playerId: r.playerId,
      positions: p?.positions ?? [],
      value: hasGame ? (p?.valuePerGame ?? 0) * prob : 0,
      hasGame: hasGame && prob > 0,
      onInjuredList: INJURED_SLOTS.includes(r.slot as Slot),
    };
  });
}

async function withMatchupWeights(leagueId: number, date: string) {
  const base = await loadLeagueContext(leagueId, { date });
  if (base.rules.scoring_type === "h2h_points" || !base.settings.matchupAware || !base.myTeam) return base;
  const m = await matchupProjection(base);
  if (!m || m.kind !== "categories") return base;
  return loadLeagueContext(leagueId, { date, categoryWeights: matchupWeights(m.categories) });
}

export async function lineupView(leagueId: number, date = today()) {
  const ctx = await withMatchupWeights(leagueId, date);
  const games = (await teamsPlayingByDay([date])).get(date)!;
  if (!ctx.myTeam) return { date, rows: [] as LineupRow[], firstTip: null, rosterDate: ctx.rosterDate, scoringType: ctx.rules.scoring_type };

  const lp = lineupPlayers(ctx, ctx.myTeam.id, games, date === today());
  const result = optimizeLineup(lp, ctx.rules.roster_slots);
  const ranked = lp.filter((p) => p.hasGame).sort((a, b) => b.value - a.value);
  const lowestStarter = ranked.filter((p) => result.assignments.get(p.playerId) !== "BN").at(-1);

  const rows: LineupRow[] = rosterFor(ctx, ctx.myTeam.id).map((r) => {
    const p = ctx.players.get(r.playerId)!;
    const g = p?.nbaTeamId ? games.get(p.nbaTeamId) : undefined;
    const rec = result.assignments.get(r.playerId) ?? "BN";
    const lpp = lp.find((x) => x.playerId === r.playerId)!;
    const isStart = rec !== "BN" && rec !== "IL";
    const wasStart = r.slot !== "BN" && !INJURED_SLOTS.includes(r.slot as Slot);
    let reason: string;
    if (rec === "IL") reason = "On your injured list";
    else if (!g) reason = "No game";
    else if (p.playProbability === 0) reason = `Ruled out (${p.injuryStatus ?? p.yahooStatus})`;
    else if (isStart)
      reason = `${g.home ? "vs" : "@"} ${g.opponent}, projected value ${round(lpp.value, 2)}` +
        (p.playProbability < 1 ? ` (${p.yahooStatus ?? p.injuryStatus}, ${Math.round(p.playProbability * 100)}% to play)` : "");
    else
      reason = lowestStarter && lpp.value <= lowestStarter.value
        ? `Plays, but your starters are worth more (lowest starter ${round(lowestStarter.value, 2)})`
        : "Plays, but no open slot fits these positions";
    return {
      playerId: r.playerId,
      name: p?.name ?? `Player ${r.playerId}`,
      positions: p?.positions ?? [],
      team: p?.teamAbbr ?? null,
      status: p?.injuryStatus ?? p?.yahooStatus ?? null,
      game: g ? { ...g, tipTime: g.tipTime ? g.tipTime.toISOString() : null } : null,
      currentSlot: r.slot,
      recommendedSlot: rec,
      value: round(lpp.value, 2),
      valuePerGame: p?.valuePerGame ?? 0,
      action: rec === "IL" ? "keep" : isStart === wasStart ? "keep" : isStart ? "start" : "bench",
      reason,
    };
  });
  const order = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "BN", "IL", "IL+"];
  rows.sort((a, b) => order.indexOf(a.recommendedSlot) - order.indexOf(b.recommendedSlot) || b.value - a.value);
  const tips = [...games.values()].map((g) => g.tipTime?.getTime()).filter((t): t is number => !!t);
  return {
    date,
    rows,
    firstTip: tips.length ? new Date(Math.min(...tips)).toISOString() : null,
    rosterDate: ctx.rosterDate,
    scoringType: ctx.rules.scoring_type,
    totalValue: round(result.totalValue, 2),
  };
}

/* ------------------------------------------------------------------ */
/* Week planner                                                        */
/* ------------------------------------------------------------------ */

export async function weekView(leagueId: number, date = today()) {
  const ctx = await loadLeagueContext(leagueId, { date });
  const week = currentWeek(ctx, date);
  const byDay = await teamsPlayingByDay(week.days);
  const empty = { ...week, players: [], startsByDay: {}, totalStarts: 0, gamesPlayedLimit: ctx.rules.games_played_limit };
  if (!ctx.myTeam) return empty;

  const now = today();
  const players = rosterFor(ctx, ctx.myTeam.id).map((r) => {
    const p = ctx.players.get(r.playerId)!;
    return { playerId: r.playerId, name: p?.name ?? "?", team: p?.teamAbbr ?? null, valuePerGame: p?.valuePerGame ?? 0, days: {} as Record<string, { game: string | null; slot: string | null }>, games: 0, starts: 0 };
  });
  const startsByDay: Record<string, number> = {};
  let totalStarts = 0;
  for (const day of week.days) {
    const games = byDay.get(day)!;
    const lp = lineupPlayers(ctx, ctx.myTeam.id, games, day === now);
    const res = optimizeLineup(lp, ctx.rules.roster_slots);
    startsByDay[day] = res.starters;
    totalStarts += res.starters;
    for (const row of players) {
      const p = ctx.players.get(row.playerId);
      const g = p?.nbaTeamId ? games.get(p.nbaTeamId) : undefined;
      const slot = res.assignments.get(row.playerId) ?? "BN";
      row.days[day] = { game: g ? `${g.home ? "" : "@"}${g.opponent}` : null, slot: g ? slot : null };
      if (g) row.games++;
      if (g && slot !== "BN" && slot !== "IL") row.starts++;
    }
  }
  players.sort((a, b) => b.valuePerGame - a.valuePerGame);
  return {
    ...week,
    players,
    startsByDay,
    totalStarts,
    gamesPlayedLimit: ctx.rules.games_played_limit,
    overLimit: ctx.rules.games_played_limit != null && totalStarts > ctx.rules.games_played_limit,
  };
}

/* ------------------------------------------------------------------ */
/* Matchup                                                             */
/* ------------------------------------------------------------------ */

type MatchupResult =
  | {
      kind: "categories";
      week: number;
      categories: CategoryProjection[];
      teamName: string | null;
      opponentName: string | null;
      reference: ReferenceStat[];
      myToDate: Record<string, number>;
      oppToDate: Record<string, number>;
    }
  | {
      kind: "points";
      week: number;
      mine: number;
      opponent: number;
      mineToDate: number;
      opponentToDate: number;
      teamName: string | null;
      opponentName: string | null;
    };

/**
 * Sum of projected stat lines for a team's optimized starters over the remaining days.
 * Today only counts games that haven't tipped off; started games count once final.
 */
async function projectRemaining(ctx: LeagueContext, teamId: number, days: string[]): Promise<StatLine> {
  const byDay = await teamsPlayingByDay(days);
  let total = { ...EMPTY_LINE };
  const now = today();
  const nowTime = new Date();
  for (const day of days) {
    let games = byDay.get(day)!;
    if (day === now) games = new Map([...games].filter(([, g]) => !g.tipTime || g.tipTime > nowTime));
    const lp = lineupPlayers(ctx, teamId, games, day === now);
    const res = optimizeLineup(lp, ctx.rules.roster_slots);
    for (const [playerId, slot] of res.assignments) {
      if (slot === "BN" || slot === "IL") continue;
      const p = ctx.players.get(playerId);
      if (p) total = addLines(total, scaleLine(p.line, day === now ? p.playProbability : 1));
    }
  }
  return total;
}

/** Each day's roster for a team: its latest saved roster on or before that day. */
async function rostersOnDays(leagueId: number, teamId: number, days: string[]) {
  const out = new Map<string, { playerId: number; slot: string }[]>();
  if (days.length === 0) return out;
  const db = getDb();
  const dates = (
    await db
      .selectDistinct({ date: schema.rosterEntries.date })
      .from(schema.rosterEntries)
      .where(and(eq(schema.rosterEntries.fantasyTeamId, teamId), lte(schema.rosterEntries.date, days[days.length - 1])))
  )
    .map((r) => r.date)
    .sort();
  const pick = (day: string) => dates.filter((d) => d <= day).at(-1);
  const needed = [...new Set(days.map(pick).filter((d): d is string => Boolean(d)))];
  const rows = needed.length
    ? await db
        .select({ date: schema.rosterEntries.date, playerId: schema.rosterEntries.playerId, slot: schema.rosterEntries.slot })
        .from(schema.rosterEntries)
        .where(
          and(
            eq(schema.rosterEntries.leagueId, leagueId),
            eq(schema.rosterEntries.fantasyTeamId, teamId),
            inArray(schema.rosterEntries.date, needed),
          ),
        )
    : [];
  for (const day of days) {
    const d = pick(day);
    out.set(day, d ? rows.filter((r) => r.date === d) : []);
  }
  return out;
}

/**
 * A team's actual stats over past days from box scores, counting only players
 * in an active slot that day. "best" picks each day's optimal lineup instead
 * of the saved slots (for opponents whose daily lineups aren't recorded).
 */
async function statsOnDays(ctx: LeagueContext, teamId: number, days: string[], lineups: "saved" | "best"): Promise<StatLine> {
  let total = { ...EMPTY_LINE };
  if (days.length === 0) return total;
  const rosters = await rostersOnDays(ctx.league.id, teamId, days);
  const ids = [...new Set([...rosters.values()].flat().map((r) => r.playerId))];
  if (ids.length === 0) return total;
  const logs = await getDb()
    .select()
    .from(schema.playerGameLogs)
    .where(
      and(
        inArray(schema.playerGameLogs.playerId, ids),
        gte(schema.playerGameLogs.gameDate, days[0]),
        lte(schema.playerGameLogs.gameDate, days[days.length - 1]),
      ),
    );
  const logOf = new Map(logs.map((l) => [`${l.playerId}:${l.gameDate}`, l]));
  const byDay = lineups === "best" ? await teamsPlayingByDay(days) : null;
  for (const day of days) {
    const roster = rosters.get(day) ?? [];
    let active: number[];
    if (byDay) {
      const games = byDay.get(day)!;
      const lp: LineupPlayer[] = roster.map((r) => {
        const p = ctx.players.get(r.playerId);
        const hasGame = !!p?.nbaTeamId && games.has(p.nbaTeamId) && logOf.has(`${r.playerId}:${day}`);
        return {
          playerId: r.playerId,
          positions: p?.positions ?? [],
          value: hasGame ? (p?.valuePerGame ?? 0) : 0,
          hasGame,
          onInjuredList: INJURED_SLOTS.includes(r.slot as Slot),
        };
      });
      const res = optimizeLineup(lp, ctx.rules.roster_slots);
      active = [...res.assignments].filter(([, slot]) => slot !== "BN" && slot !== "IL").map(([id]) => id);
    } else {
      active = roster.filter((r) => ACTIVE_SLOTS.includes(r.slot as Slot)).map((r) => r.playerId);
    }
    for (const id of active) {
      const log = logOf.get(`${id}:${day}`);
      if (!log) continue;
      const line = { ...EMPTY_LINE };
      for (const k of Object.keys(EMPTY_LINE) as (keyof StatLine)[]) if (k !== "dd" && k !== "td") line[k] = log[k];
      const doubles = [log.pts, log.reb, log.ast, log.stl, log.blk].filter((v) => v >= 10).length;
      line.dd = doubles >= 2 ? 1 : 0;
      line.td = doubles >= 3 ? 1 : 0;
      total = addLines(total, line);
    }
  }
  return total;
}

/** Baseline totals plus counted stats, keyed like Yahoo's to-date stats (counting keys). */
function mergeToDate(baseline: Record<string, number>, line: StatLine): Record<string, number> {
  const out: Record<string, number> = { ...baseline };
  for (const key of Object.keys(COUNTING_STATS) as CountingStatKey[]) {
    out[key] = (baseline[key] ?? 0) + line[COUNTING_STATS[key]];
  }
  return out;
}

type MatchupRow = typeof schema.matchups.$inferSelect;

/** My team's matchup this week (drives the matchup-aware lineup weighting). */
export async function matchupProjection(ctx: LeagueContext): Promise<MatchupResult | null> {
  if (!ctx.myTeam) return null;
  const m = await latestMatchup(ctx.league.id, ctx.myTeam.id);
  if (!m || !m.opponentTeamId) return null;
  return projectMatchup(ctx, m);
}

/**
 * Projects one matchup: team (side A) vs opponentTeam (side B), as stats so far plus
 * projected starts for the rest of the week.
 */
async function projectMatchup(ctx: LeagueContext, m: MatchupRow): Promise<MatchupResult> {
  const opponentTeamId = m.opponentTeamId!;
  const week = currentWeek(ctx);
  const start = m.weekStart ?? week.start;
  const end = m.weekEnd ?? week.end;
  const from = ctx.date < start ? start : ctx.date;
  const days: string[] = [];
  for (let d = from; d <= end; d = addDays(d, 1)) days.push(d);
  const totalDays = Math.max(1, (Date.parse(end) - Date.parse(start)) / 86400000 + 1);
  const team = ctx.teams.find((t) => t.id === m.teamId);
  const opponent = ctx.teams.find((t) => t.id === opponentTeamId);

  const mine = await projectRemaining(ctx, m.teamId, days);
  const opp = await projectRemaining(ctx, opponentTeamId, days);

  // Manual leagues: stats so far = the entered baseline (through baselineThrough) plus box scores
  // of each later day's active players: saved slots for your team, the best lineup for others.
  // Yahoo leagues get their stats so far from Yahoo.
  let myToDate: Record<string, number> = m.statsToDate;
  let oppToDate: Record<string, number> = m.opponentStatsToDate;
  let myPointsToDate = m.pointsToDate ?? 0;
  let oppPointsToDate = m.opponentPointsToDate ?? 0;
  if (ctx.league.source === "manual") {
    // A side with no entered totals is counted from the start of the week.
    const last = ctx.date < end ? ctx.date : end;
    const daysAfter = (hasBaseline: boolean) => {
      const out: string[] = [];
      for (let d = hasBaseline && m.baselineThrough ? addDays(m.baselineThrough, 1) : start; d <= last; d = addDays(d, 1)) out.push(d);
      return out;
    };
    const lineups = (teamId: number) => (teamId === ctx.myTeam?.id ? "saved" : "best");
    const myBase = Object.keys(m.statsToDate).length > 0 || m.pointsToDate != null;
    const oppBase = Object.keys(m.opponentStatsToDate).length > 0 || m.opponentPointsToDate != null;
    const myLine = await statsOnDays(ctx, m.teamId, daysAfter(myBase), lineups(m.teamId));
    const oppLine = await statsOnDays(ctx, opponentTeamId, daysAfter(oppBase), lineups(opponentTeamId));
    myToDate = mergeToDate(m.statsToDate, myLine);
    oppToDate = mergeToDate(m.opponentStatsToDate, oppLine);
    myPointsToDate += pointsValue(myLine, ctx.rules.point_weights);
    oppPointsToDate += pointsValue(oppLine, ctx.rules.point_weights);
  }

  const names = { teamName: team?.name ?? null, opponentName: opponent?.name ?? null };
  if (ctx.rules.scoring_type === "h2h_points") {
    const mineToDate = round(myPointsToDate, 1);
    const oppToDate = round(oppPointsToDate, 1);
    return {
      kind: "points",
      week: m.week,
      ...names,
      mineToDate,
      opponentToDate: oppToDate,
      mine: round(mineToDate + pointsValue(mine, ctx.rules.point_weights), 1),
      opponent: round(oppToDate + pointsValue(opp, ctx.rules.point_weights), 1),
    };
  }
  return {
    kind: "categories",
    week: m.week,
    ...names,
    myToDate,
    oppToDate,
    reference: referenceStats({
      categories: ctx.rules.categories,
      myToDate,
      oppToDate,
      myRemaining: mine,
      oppRemaining: opp,
      custom: ctx.rules.custom_stats,
    }),
    categories: projectCategories({
      categories: ctx.rules.categories,
      myToDate,
      oppToDate,
      myRemaining: mine,
      oppRemaining: opp,
      weekFractionLeft: days.length / totalDays,
      custom: ctx.rules.custom_stats,
    }),
  };
}

/** Every matchup this week, yours first. Manual leagues can set any of them by hand. */
export async function matchupView(leagueId: number) {
  const ctx = await loadLeagueContext(leagueId);
  const week = currentWeek(ctx);
  let rows: MatchupRow[];
  if (ctx.league.source === "manual") {
    rows = await getDb()
      .select()
      .from(schema.matchups)
      .where(and(eq(schema.matchups.leagueId, leagueId), eq(schema.matchups.weekStart, week.start)));
  } else {
    const mine = ctx.myTeam ? await latestMatchup(leagueId, ctx.myTeam.id) : null;
    rows = mine ? [mine] : [];
  }
  const isMine = (m: MatchupRow) => m.teamId === ctx.myTeam?.id || m.opponentTeamId === ctx.myTeam?.id;
  rows.sort((a, b) => Number(isMine(b)) - Number(isMine(a)) || a.id - b.id);

  const matchups = [];
  for (const m of rows.filter((r) => r.opponentTeamId)) {
    // Show your team on the left of your own matchup.
    const row = m.opponentTeamId === ctx.myTeam?.id ? flip(m) : m;
    matchups.push({
      id: m.id,
      isMine: isMine(m),
      teamId: row.teamId,
      opponentTeamId: row.opponentTeamId!,
      teamStats: row.statsToDate,
      opponentStats: row.opponentStatsToDate,
      teamPoints: row.pointsToDate,
      opponentPoints: row.opponentPointsToDate,
      baselineThrough: row.baselineThrough,
      result: await projectMatchup(ctx, row),
    });
  }
  const manual =
    ctx.league.source === "manual"
      ? {
          week: { start: week.start, end: week.end },
          teams: ctx.teams.map((t) => ({ id: t.id, name: t.name, isMine: t.isMine })),
          scoringType: ctx.rules.scoring_type,
          inputs: ctx.rules.scoring_type === "h2h_points" ? [] : toDateInputs(ctx.rules.categories, ctx.rules.custom_stats),
        }
      : null;
  return { matchups, punted: ctx.settings.puntCategories, manual };
}

/** The same matchup seen from the other side. */
function flip(m: MatchupRow): MatchupRow {
  return {
    ...m,
    teamId: m.opponentTeamId!,
    opponentTeamId: m.teamId,
    statsToDate: m.opponentStatsToDate,
    opponentStatsToDate: m.statsToDate,
    pointsToDate: m.opponentPointsToDate,
    opponentPointsToDate: m.pointsToDate,
  };
}

/* ------------------------------------------------------------------ */
/* Add / drop                                                          */
/* ------------------------------------------------------------------ */

export async function addDropView(leagueId: number) {
  const ctx = await loadLeagueContext(leagueId);
  if (!ctx.myTeam) return { suggestions: [], roster: [], freeAgents: [], dropMargin: ctx.settings.dropMargin };
  const week = currentWeek(ctx);
  const byDay = await teamsPlayingByDay(week.remainingDays);
  const gamesLeft = (p: ModelPlayer | undefined) =>
    p?.nbaTeamId ? week.remainingDays.filter((d) => byDay.get(d)!.has(p.nbaTeamId!)).length : 0;

  const toAD = (id: number, onIL = false): AddDropPlayer => {
    const p = ctx.players.get(id);
    return {
      playerId: id,
      name: p?.name ?? "?",
      valuePerGame: p?.valuePerGame ?? 0,
      gamesThisWeek: gamesLeft(p),
      playProbability: p?.playProbability ?? 1,
      onInjuredList: onIL,
    };
  };
  const roster = rosterFor(ctx, ctx.myTeam.id).map((r) => toAD(r.playerId, INJURED_SLOTS.includes(r.slot as Slot)));
  const freeAgents = ctx.freeAgents.map((f) => ({ ...toAD(f.playerId), percentOwned: f.percentOwned, faStatus: f.status }));
  const suggestions = suggestAddDrops(roster, freeAgents, ctx.settings.dropMargin);
  return {
    suggestions,
    dropMargin: ctx.settings.dropMargin,
    roster: [...roster].sort((a, b) => a.valuePerGame - b.valuePerGame),
    freeAgents: [...freeAgents].sort((a, b) => b.valuePerGame - a.valuePerGame).slice(0, 40),
  };
}

/* ------------------------------------------------------------------ */
/* Player detail                                                       */
/* ------------------------------------------------------------------ */

/** Adds the opponent (e.g. "@BOS") to each game log row. */
async function withOpponents<T extends { gameId: number }>(logs: T[], teamId: number | null) {
  if (logs.length === 0) return [];
  const db = getDb();
  const games = await db.select().from(schema.nbaGames).where(inArray(schema.nbaGames.id, logs.map((l) => l.gameId)));
  const teams = new Map((await db.select().from(schema.nbaTeams)).map((t) => [t.id, t.abbreviation]));
  const byId = new Map(games.map((g) => [g.id, g]));
  return logs.map((l) => {
    const g = byId.get(l.gameId);
    const home = g ? g.homeTeamId === teamId : true;
    const opp = g ? teams.get(home ? g.awayTeamId : g.homeTeamId) : null;
    return { ...l, opponent: opp ? `${home ? "vs" : "@"} ${opp}` : null };
  });
}

export async function playerView(playerId: number, leagueId?: number) {
  const db = getDb();
  const [player] = await db
    .select({
      id: schema.players.id,
      name: schema.players.fullName,
      positions: schema.players.eligiblePositions,
      team: schema.nbaTeams.abbreviation,
      nbaTeamId: schema.players.nbaTeamId,
      yahooStatus: schema.players.yahooStatus,
      headshotUrl: schema.players.headshotUrl,
    })
    .from(schema.players)
    .leftJoin(schema.nbaTeams, eq(schema.nbaTeams.id, schema.players.nbaTeamId))
    .where(eq(schema.players.id, playerId));
  if (!player) return null;

  const [injury] = await db.select().from(schema.playerInjuries).where(eq(schema.playerInjuries.playerId, playerId));
  const logs = await db
    .select()
    .from(schema.playerGameLogs)
    .where(and(eq(schema.playerGameLogs.playerId, playerId), gte(schema.playerGameLogs.gameDate, addDays(today(), -240))))
    .orderBy(desc(schema.playerGameLogs.gameDate));
  const windows = computeWindows(logs, addDays(today(), -1));
  const fmt = (l: StatLine) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, round(v, 1)]));
  const last30 = computeWindows(logs.filter((l) => l.gameDate > addDays(today(), -30)), addDays(today(), -1)).season;

  const next7 = Array.from({ length: 7 }, (_, i) => addDays(today(), i));
  const byDay = await teamsPlayingByDay(next7);
  const schedule = next7
    .map((d) => ({ date: d, game: player.nbaTeamId ? byDay.get(d)!.get(player.nbaTeamId) : undefined }))
    .filter((x) => x.game)
    .map((x) => ({ date: x.date, opponent: x.game!.opponent, home: x.game!.home, tipTime: x.game!.tipTime }));

  let league: { valuePerGame: number; categoryZ: Record<string, number> } | null = null;
  if (leagueId) {
    const ctx = await loadLeagueContext(leagueId);
    const p = ctx.players.get(playerId);
    if (p) league = { valuePerGame: p.valuePerGame, categoryZ: p.categoryZ };
  }

  return {
    player,
    injury: injury ?? null,
    trends: {
      season: { games: windows.season.games, ...fmt(windows.season.line) },
      last30: { games: last30.games, ...fmt(last30.line) },
      last14: { games: windows.last14.games, ...fmt(windows.last14.line) },
      last7: { games: windows.last7.games, ...fmt(windows.last7.line) },
      projection: fmt(blendWindows(windows, DEFAULT_WEIGHTS)),
    },
    gameLog: await withOpponents(logs.slice(0, 20), player.nbaTeamId),
    schedule,
    league,
  };
}
