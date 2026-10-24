/** Suggestions: one night of NBA games (US Eastern date) and the players you could start from them, with comparison stats. */
import { and, desc, eq, gte, inArray, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { currentWeek, loadLeagueContext, teamsPlayingByDay } from "./model";
import { averageRow } from "./views";
import { addDays, today } from "../dates";

/** Days shown in the date strip: yesterday through six days ahead (US Eastern). */
export const STRIP_DAYS = [-1, 0, 1, 2, 3, 4, 5, 6];

/**
 * Tonight if any of today's games (US Eastern) has not tipped off yet; otherwise
 * the next day, so the default is always the next slate you can still set.
 */
async function defaultDate(): Promise<string> {
  const t = today();
  const games = (await teamsPlayingByDay([t])).get(t)!;
  const now = Date.now();
  const upcoming = [...games.values()].some((g) => !g.tipTime || g.tipTime.getTime() > now);
  return upcoming ? t : addDays(t, 1);
}

export async function upcomingView(leagueId: number, requested?: string | null) {
  const db = getDb();
  const t = today();
  const strip = STRIP_DAYS.map((n) => addDays(t, n));
  const date = requested && strip.includes(requested) ? requested : await defaultDate();
  const games = (await teamsPlayingByDay([date])).get(date)!;
  const teams = await db.select().from(schema.nbaTeams);
  const abbr = new Map(teams.map((t) => [t.id, t.abbreviation]));
  const matchups = new Map<string, { home: string; away: string; tipTime: string | null }>();
  for (const [teamId, g] of games) {
    const me = abbr.get(teamId)!;
    const [home, away] = g.home ? [me, g.opponent] : [g.opponent, me];
    matchups.set(`${away}@${home}`, { home, away, tipTime: g.tipTime?.toISOString() ?? null });
  }

  const ctx = await loadLeagueContext(leagueId);
  const mine = new Set(ctx.myTeam ? ctx.roster.filter((r) => r.fantasyTeamId === ctx.myTeam!.id).map((r) => r.playerId) : []);
  const ownerOf = new Map(ctx.roster.map((r) => [r.playerId, ctx.teams.find((t) => t.id === r.fantasyTeamId)?.name ?? null]));
  const playingTeamIds = [...games.keys()];
  const players = await db
    .select({
      id: schema.players.id,
      name: schema.players.fullName,
      positions: schema.players.eligiblePositions,
      nbaTeamId: schema.players.nbaTeamId,
      injury: schema.playerInjuries.status,
    })
    .from(schema.players)
    .leftJoin(schema.playerInjuries, eq(schema.playerInjuries.playerId, schema.players.id))
    .where(
      and(
        eq(schema.players.isActive, true),
        or(
          playingTeamIds.length ? inArray(schema.players.nbaTeamId, playingTeamIds) : undefined,
          mine.size ? inArray(schema.players.id, [...mine]) : undefined,
        ),
      ),
    );
  const ids = players.map((p) => p.id);
  const logs = ids.length
    ? await db
        .select()
        .from(schema.playerGameLogs)
        .where(and(inArray(schema.playerGameLogs.playerId, ids), gte(schema.playerGameLogs.gameDate, addDays(today(), -240))))
        .orderBy(desc(schema.playerGameLogs.gameDate))
    : [];
  const logsOf = new Map<number, (typeof logs)[number][]>();
  for (const l of logs) logsOf.set(l.playerId, [...(logsOf.get(l.playerId) ?? []), l]);

  const week = currentWeek(ctx);
  const byDay = await teamsPlayingByDay(week.remainingDays);
  const rows = players.map((p) => {
    const m = ctx.players.get(p.id);
    const g = p.nbaTeamId ? games.get(p.nbaTeamId) : undefined;
    const own = logsOf.get(p.id) ?? [];
    return {
      ...p,
      team: p.nbaTeamId ? (abbr.get(p.nbaTeamId) ?? null) : null,
      game: g ? `${g.home ? "vs" : "@"} ${g.opponent}` : null,
      mine: mine.has(p.id),
      owner: ownerOf.get(p.id) ?? null,
      value: m?.valuePerGame ?? null,
      categoryZ: m?.categoryZ ?? {},
      gamesLeftThisWeek: p.nbaTeamId ? week.remainingDays.filter((d) => byDay.get(d)!.has(p.nbaTeamId!)).length : 0,
      season: averageRow(own),
      last5: averageRow(own.filter((l) => l.minutes > 0).slice(0, 5)),
    };
  });
  rows.sort((a, b) => (b.value ?? -99) - (a.value ?? -99));
  return {
    date,
    today: t,
    strip,
    games: [...matchups.values()].sort((a, b) => (a.tipTime ?? "").localeCompare(b.tipTime ?? "")),
    categories: ctx.rules.categories,
    rosterSlots: ctx.rules.roster_slots,
    players: rows,
  };
}
