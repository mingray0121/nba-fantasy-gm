import {
  NEGATIVE_STATS,
  PERCENT_STATS,
  statValue,
  type PercentStatKey,
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
  pct?: number; // pool percentage for FG%/FT%/3P%
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
  categories: StatKey[],
  opts: { punt?: string[]; weights?: Partial<Record<StatKey, number>> } = {},
) {
  const active = categories.filter((c) => !opts.punt?.includes(c));
  const stats = new Map<StatKey, CatStats>();

  for (const cat of active) {
    let raw: number[];
    let pct: number | undefined;
    if (cat in PERCENT_STATS) {
      const { made, att } = PERCENT_STATS[cat as PercentStatKey];
      const totalMade = pool.reduce((s, l) => s + l[made], 0);
      const totalAtt = pool.reduce((s, l) => s + l[att], 0);
      pct = totalAtt > 0 ? totalMade / totalAtt : 0;
      raw = pool.map((l) => l[att] * (statValue(l, cat) - pct!));
    } else {
      raw = pool.map((l) => statValue(l, cat));
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
      let v: number;
      if (s.pct !== undefined) {
        const { att } = PERCENT_STATS[cat as PercentStatKey];
        v = line[att] * (statValue(line, cat) - s.pct);
      } else {
        v = statValue(line, cat);
      }
      let score = (v - s.mean) / s.sd;
      if (NEGATIVE_STATS.has(cat)) score = -score;
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
