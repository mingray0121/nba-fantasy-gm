/**
 * Yahoo Fantasy JSON (format=json) is an XML translation: collections are
 * objects keyed "0".."n" plus "count", and entities are arrays of
 * single-key objects. These helpers turn it into plain data.
 */
import { normalizeSlot, type LeagueRules, type Slot } from "../rules/schema";
import { YAHOO_STAT_IDS, normalizeStatKey, type StatKey } from "../stats";
import type { ScoringType } from "@/db/schema";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Y = any;

/** {"0": a, "1": b, "count": 2} -> [a, b]; arrays pass through. */
export function yList(collection: Y): Y[] {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  return Object.keys(collection)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => collection[k]);
}

/** [{a:1},{b:2},[{c:3}]] -> {a:1,b:2,c:3} (nested arrays are flattened too). */
export function yMerge(parts: Y): Record<string, Y> {
  const out: Record<string, Y> = {};
  const visit = (p: Y) => {
    if (Array.isArray(p)) p.forEach(visit);
    else if (p && typeof p === "object") Object.assign(out, p);
  };
  visit(parts);
  return out;
}

export interface YahooLeague {
  leagueKey: string;
  name: string;
  season: number;
  numTeams: number;
  currentWeek: number | null;
  scoringType: string;
}

export function parseUserLeagues(body: Y): YahooLeague[] {
  const users = yList(body.fantasy_content.users);
  const out: YahooLeague[] = [];
  for (const u of users) {
    const userParts = yMerge(u.user);
    for (const g of yList(userParts.games)) {
      const gameParts = yMerge(g.game);
      for (const l of yList(gameParts.leagues)) {
        const m = yMerge(l.league);
        out.push({
          leagueKey: m.league_key,
          name: m.name,
          season: Number(m.season),
          numTeams: Number(m.num_teams),
          currentWeek: m.current_week != null ? Number(m.current_week) : null,
          scoringType: m.scoring_type,
        });
      }
    }
  }
  return out;
}

export function mapScoringType(yahoo: string): ScoringType {
  if (yahoo === "headpoint" || yahoo === "point") return "h2h_points";
  if (yahoo === "roto") return "roto";
  return "h2h_categories";
}

/** league/{key}/settings -> normalized rules plus the raw settings to keep. */
export function parseLeagueSettings(body: Y): { rules: LeagueRules; meta: Record<string, Y>; raw: Y } {
  const league = body.fantasy_content.league;
  const meta = yMerge(league[0]);
  const settings = yMerge(league[1].settings);
  const scoring_type = mapScoringType(meta.scoring_type ?? settings.scoring_type);

  const roster_slots: Partial<Record<Slot, number>> = {};
  for (const rp of yList(settings.roster_positions)) {
    const p = rp.roster_position ?? rp;
    const slot = normalizeSlot(String(p.position));
    if (slot) roster_slots[slot] = (roster_slots[slot] ?? 0) + Number(p.count ?? 1);
  }

  const modifiers = new Map<number, number>();
  for (const s of yList(settings.stat_modifiers?.stats)) {
    const stat = s.stat ?? s;
    modifiers.set(Number(stat.stat_id), Number(stat.value));
  }

  const categories: StatKey[] = [];
  const point_weights: Partial<Record<StatKey, number>> = {};
  for (const s of yList(settings.stat_categories?.stats)) {
    const stat = s.stat ?? s;
    if (stat.is_only_display_stat === "1" || stat.is_only_display_stat === 1) continue;
    if (stat.enabled === "0") continue;
    const key = yahooStatKey(stat);
    if (!key) continue;
    if (scoring_type === "h2h_points") {
      const w = modifiers.get(Number(stat.stat_id));
      if (w != null) point_weights[key] = w;
    } else {
      categories.push(key);
    }
  }

  const maxGames = settings.max_games_played ?? settings.max_weekly_games;
  const maxAdds = settings.max_weekly_adds ?? settings.max_adds;
  return {
    meta,
    raw: settings,
    rules: {
      scoring_type,
      categories,
      custom_stats: {},
      point_weights,
      roster_slots,
      games_played_limit: maxGames != null && Number(maxGames) > 0 ? Number(maxGames) : null,
      max_adds_per_week: maxAdds != null && Number(maxAdds) >= 0 ? Number(maxAdds) : null,
      week_start_day: 1, // Yahoo NBA weeks start Monday
    },
  };
}

function yahooStatKey(stat: Y): StatKey | null {
  const fromId = YAHOO_STAT_IDS[Number(stat.stat_id)];
  if (fromId) return fromId;
  return normalizeStatKey(String(stat.abbr ?? stat.display_name ?? ""));
}

export interface YahooTeam {
  teamKey: string;
  name: string;
  managerName: string | null;
  isMine: boolean;
}

export function parseTeams(body: Y): YahooTeam[] {
  const teams = yList(body.fantasy_content.league[1].teams);
  return teams.map((t) => {
    const m = yMerge(t.team[0] ?? t.team);
    const managers = yList(m.managers).map((x: Y) => x.manager ?? x);
    return {
      teamKey: m.team_key,
      name: m.name,
      managerName: managers[0]?.nickname ?? null,
      isMine:
        m.is_owned_by_current_login === 1 ||
        m.is_owned_by_current_login === "1" ||
        managers.some((x: Y) => x.is_current_login === "1" || x.is_current_login === 1),
    };
  });
}

export interface YahooPlayer {
  playerKey: string;
  fullName: string;
  teamAbbr: string | null;
  eligiblePositions: string[];
  status: string | null;
  injuryNote: string | null;
  headshotUrl: string | null;
  selectedPosition: string | null;
  percentOwned: number | null;
}

export function parsePlayer(entry: Y): YahooPlayer {
  const parts = entry.player ?? entry;
  const info = yMerge(parts[0]);
  const rest = yMerge(parts.slice(1));
  const selected = rest.selected_position ? yMerge(rest.selected_position) : null;
  const owned = rest.percent_owned ? yMerge(rest.percent_owned) : null;
  return {
    playerKey: info.player_key,
    fullName: info.name?.full ?? `${info.name?.first ?? ""} ${info.name?.last ?? ""}`.trim(),
    teamAbbr: info.editorial_team_abbr ?? null,
    eligiblePositions: yList(info.eligible_positions)
      .map((p: Y) => String(p.position ?? p))
      .filter((p: string) => !["IL", "IL+", "BN", "Util", "UTIL"].includes(p)),
    status: info.status || null,
    injuryNote: info.injury_note ?? info.status_full ?? null,
    headshotUrl: info.headshot?.url ?? info.image_url ?? null,
    selectedPosition: selected?.position ?? null,
    percentOwned: owned?.value != null ? Number(owned.value) : null,
  };
}

/** team/{key}/roster;date=... */
export function parseRoster(body: Y): YahooPlayer[] {
  const team = body.fantasy_content.team;
  const roster = yMerge(team.slice(1)).roster;
  const players = roster["0"]?.players ?? roster.players;
  return yList(players).map(parsePlayer);
}

/** league/{key}/players;... */
export function parseLeaguePlayers(body: Y): YahooPlayer[] {
  const league = body.fantasy_content.league;
  const players = yMerge(league.slice(1)).players;
  return yList(players).map(parsePlayer);
}

export interface YahooMatchupTeam {
  teamKey: string;
  stats: Partial<Record<StatKey, number>>;
  points: number | null;
}

export interface YahooMatchup {
  week: number;
  weekStart: string | null;
  weekEnd: string | null;
  teams: YahooMatchupTeam[];
}

export function parseScoreboard(body: Y): YahooMatchup[] {
  const league = body.fantasy_content.league;
  const scoreboard = yMerge(league.slice(1)).scoreboard;
  const matchups = yList(scoreboard["0"]?.matchups ?? scoreboard.matchups);
  return matchups.map((mm: Y) => {
    const m = mm.matchup;
    const teams = yList(m["0"]?.teams ?? m.teams).map((tt: Y) => {
      const info = yMerge(tt.team[0]);
      const rest = yMerge(tt.team.slice(1));
      const stats: Partial<Record<StatKey, number>> = {};
      for (const s of yList(rest.team_stats?.stats)) {
        const stat = s.stat ?? s;
        const key = YAHOO_STAT_IDS[Number(stat.stat_id)];
        if (!key) continue;
        const v = Number(stat.value);
        if (!Number.isNaN(v)) stats[key] = v;
      }
      // Combined FGM/FGA (9004003) and FTM/FTA (9007006) values look like "45/98".
      for (const s of yList(rest.team_stats?.stats)) {
        const stat = s.stat ?? s;
        const [made, att] = String(stat.value ?? "").split("/").map(Number);
        if (Number(stat.stat_id) === 9004003 && !Number.isNaN(att)) Object.assign(stats, { FGM: made, FGA: att });
        if (Number(stat.stat_id) === 9007006 && !Number.isNaN(att)) Object.assign(stats, { FTM: made, FTA: att });
      }
      return {
        teamKey: info.team_key,
        stats,
        points: rest.team_points?.total != null ? Number(rest.team_points.total) : null,
      };
    });
    return {
      week: Number(m.week),
      weekStart: m.week_start ?? null,
      weekEnd: m.week_end ?? null,
      teams,
    };
  });
}

export interface YahooTransactionMove {
  transactionKey: string;
  type: "add" | "drop" | "trade";
  timestamp: number;
  playerKey: string;
  playerName: string;
  teamKey: string | null;
}

export function parseTransactions(body: Y): YahooTransactionMove[] {
  const league = body.fantasy_content.league;
  const txs = yList(yMerge(league.slice(1)).transactions);
  const out: YahooTransactionMove[] = [];
  for (const t of txs) {
    const meta = yMerge(t.transaction[0]);
    const rest = yMerge(t.transaction.slice(1));
    if (meta.status && meta.status !== "successful") continue;
    for (const p of yList(rest.players)) {
      const info = yMerge(p.player[0]);
      const data = yMerge(p.player[1]?.transaction_data);
      const type = data.type === "add" || data.type === "drop" ? data.type : "trade";
      out.push({
        transactionKey: meta.transaction_key,
        type,
        timestamp: Number(meta.timestamp),
        playerKey: info.player_key,
        playerName: info.name?.full ?? "",
        teamKey: data.destination_team_key ?? data.source_team_key ?? null,
      });
    }
  }
  return out;
}
