import { getAccessToken } from "./oauth";
import * as parse from "./parse";

const BASE = "https://fantasysports.yahooapis.com/fantasy/v2";

/** Read-only Yahoo Fantasy client for one signed-in user. */
export class YahooClient {
  constructor(private userId: number) {}

  private async get(path: string): Promise<unknown> {
    const token = await getAccessToken(this.userId);
    const sep = path.includes("?") ? "&" : "?";
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${BASE}/${path}${sep}format=json`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (res.ok) return res.json();
      // Yahoo rate limits with 999 / 429; back off briefly and retry twice.
      if ((res.status === 999 || res.status === 429 || res.status >= 500) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw new Error(`Yahoo ${res.status} for ${path}: ${(await res.text()).slice(0, 300)}`);
    }
  }

  /** Your NBA leagues for the current season. */
  async myLeagues() {
    return parse.parseUserLeagues(await this.get("users;use_login=1/games;game_keys=nba/leagues"));
  }

  async leagueSettings(leagueKey: string) {
    return parse.parseLeagueSettings(await this.get(`league/${leagueKey}/settings`));
  }

  async teams(leagueKey: string) {
    return parse.parseTeams(await this.get(`league/${leagueKey}/teams`));
  }

  async roster(teamKey: string, date: string) {
    return parse.parseRoster(await this.get(`team/${teamKey}/roster;date=${date}`));
  }

  /** Free agents (status FA) or players on waivers (status W), ranked by Yahoo's actual rank. */
  async availablePlayers(leagueKey: string, status: "FA" | "W", start = 0, count = 25) {
    return parse.parseLeaguePlayers(
      await this.get(
        `league/${leagueKey}/players;status=${status};sort=AR;start=${start};count=${count};out=percent_owned`,
      ),
    );
  }

  async scoreboard(leagueKey: string, week?: number) {
    const w = week != null ? `;week=${week}` : "";
    return parse.parseScoreboard(await this.get(`league/${leagueKey}/scoreboard${w}`));
  }

  async transactions(leagueKey: string, count = 25) {
    return parse.parseTransactions(
      await this.get(`league/${leagueKey}/transactions;types=add,drop,trade;count=${count}`),
    );
  }
}
