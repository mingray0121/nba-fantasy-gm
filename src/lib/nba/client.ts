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
          dnpReason: null,
        });
      }
      cursor = body.meta?.next_cursor ? String(body.meta.next_cursor) : undefined;
    } while (cursor);
    return game.teams ? lines.filter((l) => game.teams!.includes(l.teamAbbr)) : lines;
  }
}

export function primarySource(): NbaDataSource {
  return new NbaCdnSource();
}

export function fallbackSource(): BallDontLieSource | null {
  const key = optionalEnv("BALLDONTLIE_API_KEY");
  return key ? new BallDontLieSource(key) : null;
}
