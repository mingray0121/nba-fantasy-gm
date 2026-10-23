import {
  PERCENT_STATS,
  categoryValue,
  isNegativeCategory,
  ratioParts,
  statValue,
  type CustomStats,
  type StatKey,
  type StatLine,
} from "../stats";

/** Points league: projected stats times the league's point weights. */
export function pointsValue(line: StatLine, weights: Partial<Record<StatKey, number>>): number {
  let total = 0;
  for (const [key, w] of Object.entries(weights) as [StatKey, number][]) {
    if (key in PERCENT_STATS) continue; // points leagues don't score percentages
    total += statValue(line, key) * w;
  }
  return total;
}

export interface CategoryScore {
  z: Record<string, number>;
  total: number;
}

interface CatStats {
  mean: number;
  sd: number;
  pct?: number; // pool percentage (or ratio) for ratio categories
}

/**
 * Categories league: builds a z-score scorer from a player pool (normally the
 * league's rostered players). Percentage categories are scored on impact
 * (attempts x difference from the pool percentage), turnovers count negative,
 * and punted categories are left out. Optional weights scale each category
 * (used by the matchup-aware tweak).
 */
export function buildCategoryScorer(
  pool: StatLine[],
  categories: string[],
  opts: { punt?: string[]; weights?: Partial<Record<string, number>>; custom?: CustomStats } = {},
) {
  const custom = opts.custom ?? {};
  const active = categories.filter((c) => !opts.punt?.includes(c));
  const stats = new Map<string, CatStats>();

  for (const cat of active) {
    const parts = ratioParts(cat, custom);
    let raw: number[];
    let pct: number | undefined;
    if (parts) {
      const totalNum = pool.reduce((s, l) => s + parts.num(l), 0);
      const totalDen = pool.reduce((s, l) => s + parts.den(l), 0);
      pct = totalDen > 0 ? totalNum / totalDen : 0;
      // attempts x (player % - pool %), written so a ratio with 0 attempts (A/T with no turnovers) still counts.
      raw = pool.map((l) => parts.num(l) - pct! * parts.den(l));
    } else {
      raw = pool.map((l) => categoryValue(l, cat, custom));
    }
    const mean = raw.reduce((s, v) => s + v, 0) / Math.max(raw.length, 1);
    const variance = raw.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(raw.length, 1);
    stats.set(cat, { mean, sd: Math.sqrt(variance) || 1, pct });
  }

  return (line: StatLine): CategoryScore => {
    const z: Record<string, number> = {};
    let total = 0;
    for (const cat of active) {
      const s = stats.get(cat)!;
      const parts = ratioParts(cat, custom);
      const v = parts && s.pct !== undefined ? parts.num(line) - s.pct * parts.den(line) : categoryValue(line, cat, custom);
      let score = (v - s.mean) / s.sd;
      if (isNegativeCategory(cat, custom)) score = -score;
      score *= opts.weights?.[cat] ?? 1;
      z[cat] = round(score);
      total += score;
    }
    return { z, total: round(total) };
  };
}

export function round(n: number, places = 3) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
