/**
 * Canonical stat keys used by league rules, projections and the engine.
 * Counting stats map to a projection field; percentages are computed from makes and attempts.
 */
export const COUNTING_STATS = {
  PTS: "pts",
  REB: "reb",
  OREB: "oreb",
  DREB: "dreb",
  AST: "ast",
  STL: "stl",
  BLK: "blk",
  TO: "tov",
  "3PM": "fg3m",
  "3PA": "fg3a",
  FGM: "fgm",
  FGA: "fga",
  FTM: "ftm",
  FTA: "fta",
  DD: "dd",
  TD: "td",
  MIN: "minutes",
} as const;

export const PERCENT_STATS = {
  "FG%": { made: "fgm", att: "fga" },
  "FT%": { made: "ftm", att: "fta" },
  "3P%": { made: "fg3m", att: "fg3a" },
  // Assist-to-turnover ratio: a ratio of two counting stats, scored like a percentage.
  "A/T": { made: "ast", att: "tov" },
} as const;

export type CountingStatKey = keyof typeof COUNTING_STATS;
export type PercentStatKey = keyof typeof PERCENT_STATS;
export type StatKey = CountingStatKey | PercentStatKey;
export type StatField = (typeof COUNTING_STATS)[CountingStatKey];

export const STAT_KEYS = [
  ...Object.keys(COUNTING_STATS),
  ...Object.keys(PERCENT_STATS),
] as StatKey[];

/** Stats where lower is better. */
export const NEGATIVE_STATS = new Set<StatKey>(["TO"]);

export const STAT_DISPLAY: Record<StatKey, string> = {
  PTS: "Points",
  REB: "Rebounds",
  OREB: "Offensive rebounds",
  DREB: "Defensive rebounds",
  AST: "Assists",
  STL: "Steals",
  BLK: "Blocks",
  TO: "Turnovers",
  "3PM": "3-pointers made",
  "3PA": "3-pointers attempted",
  FGM: "Field goals made",
  FGA: "Field goals attempted",
  FTM: "Free throws made",
  FTA: "Free throws attempted",
  DD: "Double-doubles",
  TD: "Triple-doubles",
  MIN: "Minutes",
  "FG%": "Field goal %",
  "FT%": "Free throw %",
  "3P%": "3-point %",
  "A/T": "Assist / turnover ratio",
};

/** Aliases seen in Yahoo settings, uploads and CSVs, mapped to canonical keys. */
const ALIASES: Record<string, StatKey> = {
  PTS: "PTS",
  POINTS: "PTS",
  REB: "REB",
  TREB: "REB",
  REBOUNDS: "REB",
  OREB: "OREB",
  DREB: "DREB",
  AST: "AST",
  ASSISTS: "AST",
  ST: "STL",
  STL: "STL",
  STEALS: "STL",
  BLK: "BLK",
  BLOCKS: "BLK",
  TO: "TO",
  TOV: "TO",
  TURNOVERS: "TO",
  "3PTM": "3PM",
  "3PM": "3PM",
  "3PT": "3PM",
  FG3M: "3PM",
  "3PTA": "3PA",
  "3PA": "3PA",
  FGM: "FGM",
  FGA: "FGA",
  FTM: "FTM",
  FTA: "FTA",
  DD: "DD",
  TD: "TD",
  MIN: "MIN",
  "FG%": "FG%",
  FGPCT: "FG%",
  "FT%": "FT%",
  FTPCT: "FT%",
  "3PT%": "3P%",
  "3P%": "3P%",
  "A/T": "A/T",
  "AST/TO": "A/T",
  "AST/TOV": "A/T",
  ATO: "A/T",
};

export function normalizeStatKey(raw: string): StatKey | null {
  return ALIASES[raw.trim().toUpperCase().replace(/\s+/g, "")] ?? null;
}

/** Yahoo NBA stat_id -> canonical key (used when a category has no usable abbreviation). */
export const YAHOO_STAT_IDS: Record<number, StatKey> = {
  2: "MIN",
  3: "FGA",
  4: "FGM",
  5: "FG%",
  6: "FTA",
  7: "FTM",
  8: "FT%",
  9: "3PA",
  10: "3PM",
  11: "3P%",
  12: "PTS",
  13: "OREB",
  14: "DREB",
  15: "REB",
  16: "AST",
  17: "STL",
  18: "BLK",
  19: "TO",
  27: "DD",
  28: "TD",
};

export type StatLine = Record<StatField, number>;

export const EMPTY_LINE: StatLine = {
  pts: 0,
  reb: 0,
  oreb: 0,
  dreb: 0,
  ast: 0,
  stl: 0,
  blk: 0,
  tov: 0,
  fg3m: 0,
  fg3a: 0,
  fgm: 0,
  fga: 0,
  ftm: 0,
  fta: 0,
  dd: 0,
  td: 0,
  minutes: 0,
};

/** Value of one stat key for a stat line (percentages as 0..1, A/T as a ratio). */
export function statValue(line: StatLine, key: StatKey): number {
  if (key in PERCENT_STATS) {
    const { made, att } = PERCENT_STATS[key as PercentStatKey];
    return line[att] > 0 ? line[made] / line[att] : 0;
  }
  return line[COUNTING_STATS[key as CountingStatKey]];
}

export function addLines(a: StatLine, b: StatLine, scaleB = 1): StatLine {
  const out = { ...a };
  for (const k of Object.keys(out) as StatField[]) out[k] = a[k] + b[k] * scaleB;
  return out;
}

export function scaleLine(a: StatLine, s: number): StatLine {
  const out = { ...a };
  for (const k of Object.keys(out) as StatField[]) out[k] = a[k] * s;
  return out;
}
