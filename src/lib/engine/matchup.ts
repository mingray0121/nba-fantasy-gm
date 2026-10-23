import {
  EMPTY_LINE,
  PERCENT_STATS,
  categoryValue,
  isNegativeCategory,
  ratioParts,
  type CustomStats,
  type PercentStatKey,
  type StatKey,
  type StatLine,
} from "../stats";
import { round } from "./values";

export type CategoryState = "winning" | "losing" | "close";

export interface CategoryProjection {
  key: string;
  mine: number;
  opponent: number;
  mineSoFar: number;
  opponentSoFar: number;
  state: CategoryState;
  decided: boolean; // margin big enough that more effort barely matters
}

type ToDate = Partial<Record<string, number>>;

/**
 * Projects final category totals as stats so far plus projected remaining
 * starts. Ratios use their makes and attempts when Yahoo reports them; when it
 * only reports the ratio, it's weighted with the projection by how much of
 * the week is still to come.
 */
export function projectCategories(input: {
  categories: string[];
  myToDate: ToDate;
  oppToDate: ToDate;
  myRemaining: StatLine;
  oppRemaining: StatLine;
  weekFractionLeft: number;
  custom?: CustomStats;
}): CategoryProjection[] {
  const custom = input.custom ?? {};
  return input.categories.map((key) => {
    const mine = finalValue(key, input.myToDate, input.myRemaining, input.weekFractionLeft, custom);
    const opponent = finalValue(key, input.oppToDate, input.oppRemaining, input.weekFractionLeft, custom);
    const better = isNegativeCategory(key, custom) ? opponent - mine : mine - opponent;
    let margin: number;
    let closeAt: number;
    let decidedAt: number;
    if (key in PERCENT_STATS && key !== "A/T") {
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
      mineSoFar: round(finalValue(key, input.myToDate, EMPTY_LINE, 0, custom), 4),
      opponentSoFar: round(finalValue(key, input.oppToDate, EMPTY_LINE, 0, custom), 4),
      state,
      decided: Math.abs(margin) >= decidedAt,
    };
  });
}

/** Week-to-date counting stats behind each built-in ratio category. */
const TO_DATE_PARTS: Record<PercentStatKey, [StatKey, StatKey]> = {
  "FG%": ["FGM", "FGA"],
  "FT%": ["FTM", "FTA"],
  "3P%": ["3PM", "3PA"],
  "A/T": ["AST", "TO"],
};

/** The week-to-date numbers a matchup needs: makes and attempts for ratios, totals for everything else. */
export function toDateInputs(categories: string[], custom: CustomStats = {}): string[] {
  const out: string[] = [];
  for (const key of categories) {
    const def = custom[key];
    const parts = def && "ratio" in def ? def.ratio : key in TO_DATE_PARTS ? TO_DATE_PARTS[key as PercentStatKey] : [key];
    for (const k of parts) if (!out.includes(k)) out.push(k);
  }
  return out;
}

function finalValue(key: string, toDate: ToDate, remaining: StatLine, fractionLeft: number, custom: CustomStats): number {
  const def = custom[key];
  if (def && "sum" in def) {
    const sofar = toDate[key] ?? def.sum.reduce((s, k) => s + (toDate[k] ?? 0), 0);
    return sofar + categoryValue(remaining, key, custom);
  }
  const parts = ratioParts(key, custom);
  if (parts) {
    const [madeKey, attKey] = def && "ratio" in def ? def.ratio : TO_DATE_PARTS[key as PercentStatKey];
    const m0 = toDate[madeKey];
    const a0 = toDate[attKey];
    if (m0 != null && a0 != null) {
      const a = a0 + parts.den(remaining);
      return a > 0 ? (m0 + parts.num(remaining)) / a : 0;
    }
    const projected = categoryValue(remaining, key, custom);
    const sofar = toDate[key];
    if (sofar == null || sofar === 0) return projected;
    return sofar * (1 - fractionLeft) + projected * fractionLeft;
  }
  return (toDate[key] ?? 0) + categoryValue(remaining, key, custom);
}

/** Close categories count more, decided ones less. */
export function matchupWeights(projections: CategoryProjection[]): Partial<Record<string, number>> {
  const w: Partial<Record<string, number>> = {};
  for (const p of projections) w[p.key] = p.decided ? 0.5 : p.state === "close" ? 1.5 : 1;
  return w;
}
