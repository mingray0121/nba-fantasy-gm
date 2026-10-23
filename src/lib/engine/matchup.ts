import { NEGATIVE_STATS, PERCENT_STATS, statValue, type PercentStatKey, type StatKey, type StatLine } from "../stats";
import { round } from "./values";

export type CategoryState = "winning" | "losing" | "close";

export interface CategoryProjection {
  key: StatKey;
  mine: number;
  opponent: number;
  state: CategoryState;
  decided: boolean; // margin big enough that more effort barely matters
}

/**
 * Projects final category totals as stats so far plus projected remaining
 * starts. Percentages use makes and attempts when Yahoo reports them; when it
 * only reports the percentage, it's weighted with the projection by how much of
 * the week's attempts are still to come.
 */
export function projectCategories(input: {
  categories: StatKey[];
  myToDate: Partial<Record<StatKey, number>>;
  oppToDate: Partial<Record<StatKey, number>>;
  myRemaining: StatLine;
  oppRemaining: StatLine;
  weekFractionLeft: number;
}): CategoryProjection[] {
  return input.categories.map((key) => {
    const mine = finalValue(key, input.myToDate, input.myRemaining, input.weekFractionLeft);
    const opponent = finalValue(key, input.oppToDate, input.oppRemaining, input.weekFractionLeft);
    const better = NEGATIVE_STATS.has(key) ? opponent - mine : mine - opponent;
    let margin: number;
    let closeAt: number;
    let decidedAt: number;
    if (key in PERCENT_STATS) {
      margin = better;
      closeAt = 0.01;
      decidedAt = 0.035;
    } else {
      margin = better / Math.max(1, (Math.abs(mine) + Math.abs(opponent)) / 2);
      closeAt = 0.08;
      decidedAt = 0.25;
    }
    const state: CategoryState = Math.abs(margin) < closeAt ? "close" : margin > 0 ? "winning" : "losing";
    return {
      key,
      mine: round(mine, 4),
      opponent: round(opponent, 4),
      state,
      decided: Math.abs(margin) >= decidedAt,
    };
  });
}

function finalValue(
  key: StatKey,
  toDate: Partial<Record<StatKey, number>>,
  remaining: StatLine,
  fractionLeft: number,
): number {
  if (key in PERCENT_STATS) {
    const { made, att } = PERCENT_STATS[key as PercentStatKey];
    const madeKey = key === "FG%" ? "FGM" : key === "FT%" ? "FTM" : "3PM";
    const attKey = key === "FG%" ? "FGA" : key === "FT%" ? "FTA" : "3PA";
    const m0 = toDate[madeKey];
    const a0 = toDate[attKey];
    if (m0 != null && a0 != null) {
      const a = a0 + remaining[att];
      return a > 0 ? (m0 + remaining[made]) / a : 0;
    }
    const projected = statValue(remaining, key);
    const sofar = toDate[key];
    if (sofar == null || sofar === 0) return projected;
    return sofar * (1 - fractionLeft) + projected * fractionLeft;
  }
  return (toDate[key] ?? 0) + statValue(remaining, key);
}

/** Close categories count more, decided ones less. */
export function matchupWeights(projections: CategoryProjection[]): Partial<Record<StatKey, number>> {
  const w: Partial<Record<StatKey, number>> = {};
  for (const p of projections) w[p.key] = p.decided ? 0.5 : p.state === "close" ? 1.5 : 1;
  return w;
}
