/**
 * NBA facts (schedule and box scores). The feeds are unofficial, so everything
 * goes through the NbaDataSource interface and can be swapped.
 */
import { optionalEnv } from "../env";
import { toLocalDate } from "../dates";

export interface NbaTeamInfo {
  nbaTeamId: number;
  abbreviation: string;
  name: string;
}

export interface NbaScheduledGame {
  nbaGameId: string;
  gameDate: string; // YYYY-MM-DD, US Eastern
  tipTime: Date | null;
  home: NbaTeamInfo;
  away: NbaTeamInfo;
  status: "scheduled" | "live" | "final";
  gameType: "preseason" | "regular" | "allstar" | "playoffs" | "playin" | "cup_final";
}

export interface NbaBoxLine {
  nbaPlayerId: number | null; // null when the source has no NBA person id (fallback feed)
  name: string;
  teamAbbr: string;
  minutes: number;
  pts: number;
  reb: number;
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  fg3m: number;
  fg3a: number;
  pf: number;
  plusMinus: number;
  dnpReason: string | null;
}

export interface NbaDataSource {
  schedule(): Promise<NbaScheduledGame[]>;
  boxScore(game: { nbaGameId: string; gameDate: string }): Promise<NbaBoxLine[]>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

const GAME_TYPES: Record<string, NbaScheduledGame["gameType"]> = {
  "001": "preseason",
  "002": "regular",
  "003": "allstar",
  "004": "playoffs",
  "005": "playin",
  "006": "cup_final",
};

/** "PT34M12.00S" -> 34.2 */
export function parseIsoMinutes(v: string | null | undefined): number {
  if (!v) return 0;
  const m = /PT(?:(\d+)M)?(?:([\d.]+)S)?/.exec(v);
  if (!m) return Number(v) || 0;
  return Number(m[1] ?? 0) + Number(m[2] ?? 0) / 60;
}

function teamInfo(t: any): NbaTeamInfo {
  return {
    nbaTeamId: Number(t.teamId),
    abbreviation: t.teamTricode,
    name: [t.teamCity, t.teamName].filter(Boolean).join(" "),
  };
}

export function parseCdnSchedule(body: any): NbaScheduledGame[] {
  const out: NbaScheduledGame[] = [];
  for (const day of body.leagueSchedule?.gameDates ?? []) {
    for (const g of day.games ?? []) {
      if (!g.homeTeam?.teamId || !g.awayTeam?.teamId) continue; // TBD playoff / Cup slots
      const tip = g.gameDateTimeUTC ? new Date(g.gameDateTimeUTC) : null;
      const gameDate = g.gameDateEst
        ? String(g.gameDateEst).slice(0, 10)
        : tip
          ? toLocalDate(tip, "America/New_York")
          : "";
      out.push({
        nbaGameId: String(g.gameId),
        gameDate,
        tipTime: tip,
        home: teamInfo(g.homeTeam),
        away: teamInfo(g.awayTeam),
        status: g.gameStatus === 3 ? "final" : g.gameStatus === 2 ? "live" : "scheduled",
        gameType: GAME_TYPES[String(g.gameId).slice(0, 3)] ?? "regular",
      });
    }
  }
  return out;
}

export function parseCdnBoxScore(body: any): NbaBoxLine[] {
  const game = body.game;
  const out: NbaBoxLine[] = [];
  for (const side of [game.homeTeam, game.awayTeam]) {
    for (const p of side.players ?? []) {
      const s = p.statistics ?? {};
      out.push({
        nbaPlayerId: Number(p.personId),
        name: p.name ?? `${p.firstName} ${p.familyName}`,
        teamAbbr: side.teamTricode,
        minutes: parseIsoMinutes(s.minutesCalculated ?? s.minutes),
        pts: s.points ?? 0,
        reb: s.reboundsTotal ?? 0,
        oreb: s.reboundsOffensive ?? 0,
        dreb: s.reboundsDefensive ?? 0,
        ast: s.assists ?? 0,
        stl: s.steals ?? 0,
        blk: s.blocks ?? 0,
        tov: s.turnovers ?? 0,
        fgm: s.fieldGoalsMade ?? 0,
        fga: s.fieldGoalsAttempted ?? 0,
        ftm: s.freeThrowsMade ?? 0,
        fta: s.freeThrowsAttempted ?? 0,
        fg3m: s.threePointersMade ?? 0,
        fg3a: s.threePointersAttempted ?? 0,
        pf: s.foulsPersonal ?? 0,
        plusMinus: Math.round(s.plusMinusPoints ?? 0),
        dnpReason: p.played === "0" ? (p.notPlayingReason ?? p.notPlayingDescription ?? "DNP") : null,
      });
    }
  }
  return out;
}

async function getJson(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 nba-fantasy-assistant", Accept: "application/json", ...headers },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res.json();
}

export class NbaCdnSource implements NbaDataSource {
  async schedule() {
    return parseCdnSchedule(
      await getJson("https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json"),
    );
  }

  async boxScore(game: { nbaGameId: string }) {
    return parseCdnBoxScore(
      await getJson(`https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${game.nbaGameId}.json`),
    );
  }
}

/** Fallback box scores from balldontlie (by date, matched to the game by team). */
export class BallDontLieSource implements NbaDataSource {
  constructor(private apiKey: string) {}

  async schedule(): Promise<NbaScheduledGame[]> {
    throw new Error("balldontlie is only used as a box score fallback");
  }

  async boxScore(game: { nbaGameId: string; gameDate: string; teams?: string[] }) {
    const lines: NbaBoxLine[] = [];
    let cursor: string | undefined;
    do {
      const qs = new URLSearchParams({ "dates[]": game.gameDate, per_page: "100" });
      if (cursor) qs.set("cursor", cursor);
      const body = await getJson(`https://api.balldontlie.io/v1/stats?${qs}`, {
        Authorization: this.apiKey,
      });
      for (const s of body.data ?? []) {
        lines.push({
          nbaPlayerId: null,
          name: `${s.player.first_name} ${s.player.last_name}`,
          teamAbbr: s.team.abbreviation,
          minutes: Number(String(s.min ?? "0").split(":")[0]) || 0,
          pts: s.pts ?? 0,
          reb: s.reb ?? 0,
          oreb: s.oreb ?? 0,
          dreb: s.dreb ?? 0,
          ast: s.ast ?? 0,
          stl: s.stl ?? 0,
          blk: s.blk ?? 0,
          tov: s.turnover ?? 0,
          fgm: s.fgm ?? 0,
          fga: s.fga ?? 0,
          ftm: s.ftm ?? 0,
          fta: s.fta ?? 0,
          fg3m: s.fg3m ?? 0,
          fg3a: s.fg3a ?? 0,
          pf: s.pf ?? 0,
          plusMinus: 0,
          dnpReason: null,
        });
      }
      cursor = body.meta?.next_cursor ? String(body.meta.next_cursor) : undefined;
    } while (cursor);
    return game.teams ? lines.filter((l) => game.teams!.includes(l.teamAbbr)) : lines;
  }
}

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

/** ESPN season types: 1 preseason, 2 regular, 3 postseason, 5 play-in. */
const ESPN_SEASON_TYPES: Record<number, NbaScheduledGame["gameType"]> = {
  1: "preseason",
  2: "regular",
  3: "playoffs",
  5: "playin",
};

/** ESPN abbreviations that differ from NBA tricodes. */
const ESPN_TO_NBA_TEAM: Record<string, string> = {
  GS: "GSW",
  NO: "NOP",
  NY: "NYK",
  SA: "SAS",
  UTAH: "UTA",
  WSH: "WAS",
};

export function espnTeamAbbr(abbr: string): string {
  const up = String(abbr).toUpperCase();
  return ESPN_TO_NBA_TEAM[up] ?? up;
}

function espnTeamInfo(t: any): NbaTeamInfo {
  return {
    nbaTeamId: Number(t.id),
    abbreviation: espnTeamAbbr(t.abbreviation),
    name: t.displayName ?? [t.location, t.name].filter(Boolean).join(" "),
  };
}

/** One team's schedule from ESPN (`/teams/{id}/schedule`). */
export function parseEspnSchedule(body: any): NbaScheduledGame[] {
  const out: NbaScheduledGame[] = [];
  for (const e of body.events ?? []) {
    const c = e.competitions?.[0];
    const home = c?.competitors?.find((t: any) => t.homeAway === "home");
    const away = c?.competitors?.find((t: any) => t.homeAway === "away");
    if (!home?.team?.id || !away?.team?.id) continue;
    const tip = e.date ? new Date(e.date) : null;
    const state = c.status?.type?.state;
    out.push({
      nbaGameId: String(e.id),
      gameDate: tip ? toLocalDate(tip, "America/New_York") : "",
      tipTime: tip,
      home: espnTeamInfo(home.team),
      away: espnTeamInfo(away.team),
      status: state === "post" ? "final" : state === "in" ? "live" : "scheduled",
      gameType: ESPN_SEASON_TYPES[Number(e.seasonType?.type ?? 2)] ?? "regular",
    });
  }
  return out;
}

/** "5-10" -> [5, 10] */
function madeAttempted(v: string | undefined): [number, number] {
  const [m, a] = String(v ?? "0-0").split("-");
  return [Number(m) || 0, Number(a) || 0];
}

/** Box score from ESPN's game summary (`/summary?event={id}`). */
export function parseEspnBoxScore(body: any): NbaBoxLine[] {
  const out: NbaBoxLine[] = [];
  for (const side of body.boxscore?.players ?? []) {
    const teamAbbr = espnTeamAbbr(side.team?.abbreviation ?? "");
    for (const group of side.statistics ?? []) {
      const keys: string[] = group.keys ?? [];
      for (const a of group.athletes ?? []) {
        const stats: string[] = a.stats ?? [];
        const v = (key: string) => stats[keys.indexOf(key)];
        const n = (key: string) => Number(v(key)) || 0;
        const [fgm, fga] = madeAttempted(v("fieldGoalsMade-fieldGoalsAttempted"));
        const [fg3m, fg3a] = madeAttempted(v("threePointFieldGoalsMade-threePointFieldGoalsAttempted"));
        const [ftm, fta] = madeAttempted(v("freeThrowsMade-freeThrowsAttempted"));
        const played = !a.didNotPlay && stats.length > 0;
        out.push({
          nbaPlayerId: Number(a.athlete?.id) || null,
          name: a.athlete?.displayName ?? "",
          teamAbbr,
          minutes: n("minutes"),
          pts: n("points"),
          reb: n("rebounds"),
          oreb: n("offensiveRebounds"),
          dreb: n("defensiveRebounds"),
          ast: n("assists"),
          stl: n("steals"),
          blk: n("blocks"),
          tov: n("turnovers"),
          fgm,
          fga,
          ftm,
          fta,
          fg3m,
          fg3a,
          pf: n("fouls"),
          plusMinus: n("plusMinus"),
          dnpReason: played ? null : (a.reason ?? "DNP"),
        });
      }
    }
  }
  return out;
}

/**
 * ESPN's public site API. Unlike the NBA CDN, it does not block cloud hosts
 * (Vercel, GitHub Actions) or requests from outside the US.
 * Player and team ids are ESPN's, stored in the nba_* id columns.
 */
export class EspnSource implements NbaDataSource {
  async schedule() {
    const teams = await getJson(`${ESPN_BASE}/teams`);
    const teamIds: string[] = (teams.sports?.[0]?.leagues?.[0]?.teams ?? []).map((t: any) => String(t.team.id));
    const byId = new Map<string, NbaScheduledGame>();
    for (const seasonType of [2, 5, 3]) {
      const bodies = await Promise.all(
        teamIds.map((id) => getJson(`${ESPN_BASE}/teams/${id}/schedule?seasontype=${seasonType}`).catch(() => null)),
      );
      for (const body of bodies) {
        for (const g of body ? parseEspnSchedule(body) : []) byId.set(g.nbaGameId, g);
      }
    }
    return [...byId.values()];
  }

  async boxScore(game: { nbaGameId: string }) {
    return parseEspnBoxScore(await getJson(`${ESPN_BASE}/summary?event=${game.nbaGameId}`));
  }
}

export interface EspnRosterPlayer {
  nbaPlayerId: number;
  name: string;
  teamAbbr: string;
  positions: string[];
  injuryStatus: string | null; // "Out", "Day-To-Day", "Questionable", ...
}

/** ESPN positions to fantasy positions ("G" -> PG, SG). */
const ESPN_POSITIONS: Record<string, string[]> = {
  PG: ["PG"],
  SG: ["SG"],
  SF: ["SF"],
  PF: ["PF"],
  C: ["C"],
  G: ["PG", "SG"],
  F: ["SF", "PF"],
  GF: ["SG", "SF"],
  FC: ["PF", "C"],
};

/** One team's roster from ESPN (`/teams/{id}/roster`). */
export function parseEspnRoster(body: any): EspnRosterPlayer[] {
  const teamAbbr = espnTeamAbbr(body.team?.abbreviation ?? "");
  return (body.athletes ?? []).map((a: any) => ({
    nbaPlayerId: Number(a.id),
    name: a.fullName ?? a.displayName ?? "",
    teamAbbr,
    positions: ESPN_POSITIONS[String(a.position?.abbreviation ?? "").toUpperCase().replace("-", "")] ?? [],
    injuryStatus: a.injuries?.[0]?.status ?? null,
  }));
}

/** Every current NBA player with positions and injury status, from ESPN team rosters. */
export async function espnAllRosters(): Promise<EspnRosterPlayer[]> {
  const teams = await getJson(`${ESPN_BASE}/teams`);
  const teamIds: string[] = (teams.sports?.[0]?.leagues?.[0]?.teams ?? []).map((t: any) => String(t.team.id));
  const bodies = await Promise.all(teamIds.map((id) => getJson(`${ESPN_BASE}/teams/${id}/roster`)));
  return bodies.flatMap(parseEspnRoster);
}

export function primarySource(): NbaDataSource {
  return new EspnSource();
}

export function fallbackSource(): BallDontLieSource | null {
  const key = optionalEnv("BALLDONTLIE_API_KEY");
  return key ? new BallDontLieSource(key) : null;
}

export interface SeasonAverages {
  label: string; // "2025-26" or "Career"
  gp: number;
  min: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  fg3m: number;
  fgPct: number | null; // 0..1
  ftPct: number | null;
  fg3Pct: number | null;
}

/** ESPN per-season and career averages (`athletes/{id}/stats`), newest season first. */
export function parseEspnCareer(body: any): SeasonAverages[] {
  const cat = (body.categories ?? []).find((c: any) => c.name === "averages");
  if (!cat) return [];
  const labels: string[] = cat.labels ?? [];
  const row = (label: string, stats: string[]): SeasonAverages => {
    const v = (k: string) => stats[labels.indexOf(k)];
    const n = (k: string) => Number(v(k)) || 0;
    const pct = (k: string) => (v(k) == null || v(k) === "" ? null : Number(v(k)) / 100);
    return {
      label,
      gp: n("GP"),
      min: n("MIN"),
      pts: n("PTS"),
      reb: n("REB"),
      ast: n("AST"),
      stl: n("STL"),
      blk: n("BLK"),
      tov: n("TO"),
      fg3m: Number(String(v("3PT") ?? "0").split("-")[0]) || 0,
      fgPct: pct("FG%"),
      ftPct: pct("FT%"),
      fg3Pct: pct("3P%"),
    };
  };
  const seasons = (cat.statistics ?? []).map((s: any) => row(s.season?.displayName ?? "", s.stats ?? [])).reverse();
  return cat.totals ? [...seasons, row("Career", cat.totals)] : seasons;
}

/** Past seasons and career for one player; cached for six hours. Empty when ESPN has nothing. */
export async function espnCareer(espnPlayerId: number): Promise<SeasonAverages[]> {
  try {
    const res = await fetch(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${espnPlayerId}/stats`, {
      headers: { "User-Agent": "Mozilla/5.0 nba-fantasy-assistant", Accept: "application/json" },
      next: { revalidate: 21600 },
    });
    return res.ok ? parseEspnCareer(await res.json()) : [];
  } catch {
    return [];
  }
}
