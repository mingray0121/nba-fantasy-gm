import { EMPTY_LINE, type StatField, type StatLine } from "../stats";

export interface GameLog extends Omit<StatLine, "dd" | "td"> {
  gameDate: string;
}

export interface WindowProjection {
  games: number;
  line: StatLine; // per game
}

export type Windows = { season: WindowProjection; last14: WindowProjection; last7: WindowProjection };
export type WindowWeights = { season: number; last14: number; last7: number };

export const DEFAULT_WEIGHTS: WindowWeights = { season: 0.5, last14: 0.3, last7: 0.2 };

const FIELDS = Object.keys(EMPTY_LINE) as StatField[];

function isDouble(v: number) {
  return v >= 10 ? 1 : 0;
}

/** Per-game average over games actually played (minutes > 0). */
export function averageLogs(logs: GameLog[]): WindowProjection {
  const played = logs.filter((l) => l.minutes > 0);
  if (played.length === 0) return { games: 0, line: { ...EMPTY_LINE } };
  const sum = { ...EMPTY_LINE };
  for (const g of played) {
    for (const f of FIELDS) if (f !== "dd" && f !== "td") sum[f] += g[f];
    const doubles = isDouble(g.pts) + isDouble(g.reb) + isDouble(g.ast) + isDouble(g.stl) + isDouble(g.blk);
    sum.dd += doubles >= 2 ? 1 : 0;
    sum.td += doubles >= 3 ? 1 : 0;
  }
  const line = { ...EMPTY_LINE };
  for (const f of FIELDS) line[f] = sum[f] / played.length;
  return { games: played.length, line };
}

/** Recent windows count games played, not calendar days (rest days and back-to-backs don't skew them). */
export const RECENT_GAMES = { last14: 10, last7: 5 } as const;

/**
 * Season, last-10-game and last-5-game per-game windows as of `asOf` (games after it excluded).
 * The keys keep their original names (last14 / last7) because they are stored projection horizons.
 */
export function computeWindows(logs: GameLog[], asOf: string): Windows {
  const upTo = logs.filter((l) => l.gameDate <= asOf);
  const played = upTo.filter((l) => l.minutes > 0).sort((a, b) => (a.gameDate < b.gameDate ? 1 : -1));
  return {
    season: averageLogs(upTo),
    last14: averageLogs(played.slice(0, RECENT_GAMES.last14)),
    last7: averageLogs(played.slice(0, RECENT_GAMES.last7)),
  };
}

/**
 * Blends windows into one per-game line: per-minute rates and minutes are each
 * blended with the league's window weights (windows with no games drop out and
 * the rest are renormalized), so a recent change in minutes moves the projection.
 */
export function blendWindows(w: Windows, weights: WindowWeights = DEFAULT_WEIGHTS): StatLine {
  const parts = (["season", "last14", "last7"] as const)
    .filter((k) => w[k].games > 0 && weights[k] > 0)
    .map((k) => ({ weight: weights[k], win: w[k] }));
  const total = parts.reduce((s, p) => s + p.weight, 0);
  if (total === 0) return { ...EMPTY_LINE };

  const minutes = parts.reduce((s, p) => s + (p.weight / total) * p.win.line.minutes, 0);
  const out = { ...EMPTY_LINE, minutes };
  for (const f of FIELDS) {
    if (f === "minutes") continue;
    if (f === "dd" || f === "td") {
      out[f] = parts.reduce((s, p) => s + (p.weight / total) * p.win.line[f], 0);
      continue;
    }
    const perMinute = parts.reduce(
      (s, p) => s + (p.weight / total) * (p.win.line.minutes > 0 ? p.win.line[f] / p.win.line.minutes : 0),
      0,
    );
    out[f] = perMinute * minutes;
  }
  return out;
}

/** Chance a player plays, from Yahoo status or injury report. */
export function playProbability(status: string | null | undefined): number {
  switch ((status ?? "").toUpperCase()) {
    case "O":
    case "OUT":
    case "INJ":
    case "IL":
    case "IL+":
    case "SUSP":
    case "NA":
      return 0;
    case "DOUBTFUL":
      return 0.25;
    case "GTD":
    case "DTD":
    case "QUESTIONABLE":
      return 0.6;
    case "PROBABLE":
      return 0.9;
    default:
      return 1;
  }
}
