import { z } from "zod";
import Papa from "papaparse";
import { COUNTING_STATS, isNegativeCategory, normalizeStatKey, type CountingStatKey, type CustomStat, type CustomStats, type StatKey } from "../stats";
import type { ScoringType } from "@/db/schema";

export const SLOTS = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "BN", "IL", "IL+"] as const;
export type Slot = (typeof SLOTS)[number];
export const ACTIVE_SLOTS: Slot[] = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL"];
export const INJURED_SLOTS: Slot[] = ["IL", "IL+"];

const WEEK_DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function normalizeSlot(raw: string): Slot | null {
  const s = raw.trim().toUpperCase();
  if (s === "UTIL" || s === "U") return "UTIL";
  if (s === "BENCH") return "BN";
  if (s === "IR" || s === "INJ") return "IL";
  if (s === "IR+" || s === "IL+") return "IL+";
  return (SLOTS as readonly string[]).includes(s) ? (s as Slot) : null;
}

/** The normalized rules every part of the app reads. */
export interface LeagueRules {
  scoring_type: ScoringType;
  categories: string[]; // built-in stat keys or keys defined in custom_stats
  custom_stats: CustomStats;
  point_weights: Partial<Record<StatKey, number>>;
  roster_slots: Partial<Record<Slot, number>>;
  games_played_limit: number | null;
  max_adds_per_week: number | null;
  week_start_day: number;
}

const weekStart = z
  .union([z.number().int().min(0).max(6), z.string()])
  .transform((v, ctx) => {
    if (typeof v === "number") return v;
    const i = WEEK_DAYS.indexOf(v.trim().slice(0, 3).toLowerCase());
    if (i < 0) {
      ctx.addIssue({ code: "custom", message: `Unknown week start day "${v}"` });
      return z.NEVER;
    }
    return i;
  });

/** The upload format (JSON), also what PUT /rules accepts. */
export const rulesInput = z
  .object({
    scoring_type: z.enum(["h2h_categories", "h2h_points", "roto"]),
    categories: z.array(z.string()).optional(),
    custom_stats: z
      .record(
        z.string(),
        z.object({
          ratio: z.tuple([z.string(), z.string()]).optional(),
          sum: z.array(z.string()).min(2).optional(),
          negative: z.boolean().optional(),
        }),
      )
      .optional(),
    point_weights: z.record(z.string(), z.number()).optional(),
    roster_slots: z.record(z.string(), z.number().int().min(0).max(20)),
    games_played_limit: z.number().int().positive().nullable().optional(),
    max_adds_per_week: z.number().int().min(0).nullable().optional(),
    week_start_day: weekStart.optional(),
  })
  .transform((v, ctx): LeagueRules => {
    const roster_slots: Partial<Record<Slot, number>> = {};
    for (const [raw, count] of Object.entries(v.roster_slots)) {
      const slot = normalizeSlot(raw);
      if (!slot) {
        ctx.addIssue({ code: "custom", path: ["roster_slots", raw], message: `Unknown slot "${raw}"` });
        continue;
      }
      roster_slots[slot] = (roster_slots[slot] ?? 0) + count;
    }
    if (!ACTIVE_SLOTS.some((s) => (roster_slots[s] ?? 0) > 0)) {
      ctx.addIssue({ code: "custom", path: ["roster_slots"], message: "Needs at least one starting slot" });
    }

    const point_weights: Partial<Record<StatKey, number>> = {};
    for (const [raw, w] of Object.entries(v.point_weights ?? {})) {
      const key = normalizeStatKey(raw);
      if (!key) {
        ctx.addIssue({ code: "custom", path: ["point_weights", raw], message: `Unknown stat "${raw}"` });
        continue;
      }
      point_weights[key] = w;
    }

    const custom_stats: CustomStats = {};
    for (const [rawKey, def] of Object.entries(v.custom_stats ?? {})) {
      const key = rawKey.trim().toUpperCase();
      const path = ["custom_stats", rawKey];
      if (!key || key.length > 16) {
        ctx.addIssue({ code: "custom", path, message: "Custom stat names need 1 to 16 characters" });
        continue;
      }
      if (normalizeStatKey(key)) {
        ctx.addIssue({ code: "custom", path, message: `"${rawKey}" is already a built-in stat` });
        continue;
      }
      if (Boolean(def.ratio) === Boolean(def.sum)) {
        ctx.addIssue({ code: "custom", path, message: 'Give exactly one of "ratio" or "sum"' });
        continue;
      }
      const parts: CountingStatKey[] = [];
      for (const raw of def.ratio ?? def.sum ?? []) {
        const k = normalizeStatKey(raw);
        if (k && k in COUNTING_STATS) parts.push(k as CountingStatKey);
        else ctx.addIssue({ code: "custom", path, message: `"${raw}" is not a counting stat (use stats like PTS, AST, TO)` });
      }
      const stat: CustomStat = def.ratio
        ? { ratio: parts as [CountingStatKey, CountingStatKey], negative: def.negative }
        : { sum: parts, negative: def.negative };
      if (def.negative === undefined) delete stat.negative;
      custom_stats[key] = stat;
    }

    const categories: string[] = [];
    for (const raw of v.categories ?? []) {
      const key = normalizeStatKey(raw) ?? (custom_stats[raw.trim().toUpperCase()] ? raw.trim().toUpperCase() : null);
      if (!key) ctx.addIssue({ code: "custom", path: ["categories"], message: `Unknown stat "${raw}" (define it in custom_stats)` });
      else if (!categories.includes(key)) categories.push(key);
    }
    if (v.scoring_type === "h2h_points") {
      if (Object.keys(point_weights).length === 0) {
        ctx.addIssue({ code: "custom", path: ["point_weights"], message: "A points league needs point_weights" });
      }
    } else if (categories.length === 0) {
      ctx.addIssue({ code: "custom", path: ["categories"], message: "A categories league needs categories" });
    }

    return {
      scoring_type: v.scoring_type,
      categories: v.scoring_type === "h2h_points" ? [] : categories,
      custom_stats: v.scoring_type === "h2h_points" ? {} : custom_stats,
      point_weights: v.scoring_type === "h2h_points" ? point_weights : {},
      roster_slots,
      games_played_limit: v.games_played_limit ?? null,
      max_adds_per_week: v.max_adds_per_week ?? null,
      week_start_day: v.week_start_day ?? 1,
    };
  });

export type RulesInput = z.input<typeof rulesInput>;

export function parseRulesJson(text: string): LeagueRules {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new RulesFileError(["File is not valid JSON"]);
  }
  return validate(data);
}

/**
 * CSV upload: one row per setting, with header `type,key,value`.
 *   setting,scoring_type,h2h_categories
 *   setting,games_played_limit,
 *   setting,max_adds_per_week,4
 *   setting,week_start_day,mon
 *   category,FG%,
 *   point,PTS,1
 *   slot,PG,1
 */
export function parseRulesCsv(text: string): LeagueRules {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  if (parsed.errors.length) {
    throw new RulesFileError(parsed.errors.map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`));
  }
  const out: Record<string, unknown> & {
    categories: string[];
    point_weights: Record<string, number>;
    roster_slots: Record<string, number>;
  } = { categories: [], point_weights: {}, roster_slots: {} };
  const errors: string[] = [];
  parsed.data.forEach((row, i) => {
    const type = (row.type ?? "").trim().toLowerCase();
    const key = (row.key ?? "").trim();
    const value = (row.value ?? "").trim();
    const line = `Row ${i + 2}`;
    switch (type) {
      case "setting":
        if (key === "scoring_type") out.scoring_type = value;
        else if (key === "week_start_day") out.week_start_day = value;
        else if (key === "games_played_limit" || key === "max_adds_per_week")
          out[key] = value === "" ? null : Number(value);
        else errors.push(`${line}: unknown setting "${key}"`);
        break;
      case "category":
        out.categories.push(key);
        break;
      case "point":
        if (value === "" || Number.isNaN(Number(value))) errors.push(`${line}: point weight for ${key} must be a number`);
        else out.point_weights[key] = Number(value);
        break;
      case "slot":
        if (!/^\d+$/.test(value)) errors.push(`${line}: slot count for ${key} must be a whole number`);
        else out.roster_slots[key] = Number(value);
        break;
      default:
        errors.push(`${line}: type must be setting, category, point or slot`);
    }
  });
  if (errors.length) throw new RulesFileError(errors);
  if (out.categories.length === 0) delete (out as Record<string, unknown>).categories;
  if (Object.keys(out.point_weights).length === 0) delete (out as Record<string, unknown>).point_weights;
  return validate(out);
}

export function validate(data: unknown): LeagueRules {
  const result = rulesInput.safeParse(data);
  if (!result.success) {
    throw new RulesFileError(
      result.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)),
    );
  }
  return result.data;
}

export class RulesFileError extends Error {
  constructor(public problems: string[]) {
    super(problems.join("; "));
  }
}

export function isNegativeStat(key: string, custom: CustomStats = {}) {
  return isNegativeCategory(key, custom);
}

/** Back to the upload format, for the editor and for downloads. */
export function toRulesInput(r: LeagueRules): RulesInput {
  return {
    scoring_type: r.scoring_type,
    ...(r.scoring_type === "h2h_points"
      ? { point_weights: r.point_weights as Record<string, number> }
      : { categories: r.categories, ...(Object.keys(r.custom_stats).length ? { custom_stats: r.custom_stats } : {}) }),
    roster_slots: r.roster_slots as Record<string, number>,
    games_played_limit: r.games_played_limit,
    max_adds_per_week: r.max_adds_per_week,
    week_start_day: WEEK_DAYS[r.week_start_day],
  };
}

export const DEFAULT_RULES: LeagueRules = {
  scoring_type: "h2h_categories",
  categories: ["FG%", "FT%", "3PM", "PTS", "REB", "AST", "STL", "BLK", "TO"],
  custom_stats: {},
  point_weights: {},
  roster_slots: { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 2, UTIL: 2, BN: 3, IL: 2 },
  games_played_limit: null,
  max_adds_per_week: 4,
  week_start_day: 1,
};
