/** Read models behind the pages. Each takes one league and computes from what the jobs stored. */
import { and, desc, eq, gte } from "drizzle-orm";
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
import { matchupWeights, projectCategories, type CategoryProjection } from "../engine/matchup";
import { suggestAddDrops, type AddDropPlayer } from "../engine/addDrop";
import { computeWindows, blendWindows, DEFAULT_WEIGHTS } from "../engine/projections";
import { pointsValue, round } from "../engine/values";
import { INJURED_SLOTS, type Slot } from "../rules/schema";
import { addLines, EMPTY_LINE, scaleLine, type StatLine } from "../stats";
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
  | { kind: "categories"; week: number; categories: CategoryProjection[]; opponentName: string | null }
  | { kind: "points"; week: number; mine: number; opponent: number; mineToDate: number; opponentToDate: number; opponentName: string | null };

/** Sum of projected stat lines for a team's optimized starters over the remaining days. */
async function projectRemaining(ctx: LeagueContext, teamId: number, days: string[]): Promise<StatLine> {
  const byDay = await teamsPlayingByDay(days);
  let total = { ...EMPTY_LINE };
  const now = today();
  for (const day of days) {
    const games = byDay.get(day)!;
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

export async function matchupProjection(ctx: LeagueContext): Promise<MatchupResult | null> {
  if (!ctx.myTeam) return null;
  const m = await latestMatchup(ctx.league.id, ctx.myTeam.id);
  if (!m || !m.opponentTeamId) return null;
  const week = currentWeek(ctx);
  const start = m.weekStart ?? week.start;
  const end = m.weekEnd ?? week.end;
  // Today's stats may already be in "to date", so project from tomorrow once games have started.
  const from = ctx.date < start ? start : ctx.date;
  const days: string[] = [];
  for (let d = from; d <= end; d = addDays(d, 1)) days.push(d);
  const totalDays = Math.max(1, (Date.parse(end) - Date.parse(start)) / 86400000 + 1);
  const opponent = ctx.teams.find((t) => t.id === m.opponentTeamId);

  const mine = await projectRemaining(ctx, ctx.myTeam.id, days);
  const opp = await projectRemaining(ctx, m.opponentTeamId, days);

  if (ctx.rules.scoring_type === "h2h_points") {
    const mineToDate = m.pointsToDate ?? 0;
    const oppToDate = m.opponentPointsToDate ?? 0;
    return {
      kind: "points",
      week: m.week,
      mineToDate,
      opponentToDate: oppToDate,
      mine: round(mineToDate + pointsValue(mine, ctx.rules.point_weights), 1),
      opponent: round(oppToDate + pointsValue(opp, ctx.rules.point_weights), 1),
      opponentName: opponent?.name ?? null,
    };
  }
  return {
    kind: "categories",
    week: m.week,
    opponentName: opponent?.name ?? null,
    categories: projectCategories({
      categories: ctx.rules.categories,
      myToDate: m.statsToDate,
      oppToDate: m.opponentStatsToDate,
      myRemaining: mine,
      oppRemaining: opp,
      weekFractionLeft: days.length / totalDays,
      custom: ctx.rules.custom_stats,
    }),
  };
}

export async function matchupView(leagueId: number) {
  const ctx = await loadLeagueContext(leagueId);
  return { result: await matchupProjection(ctx), punted: ctx.settings.puntCategories };
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
    gameLog: logs.slice(0, 20),
    schedule,
    league,
  };
}
