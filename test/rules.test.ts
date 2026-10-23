import { describe, expect, it } from "vitest";
import { parseRulesCsv, parseRulesJson, RulesFileError } from "@/lib/rules/schema";

describe("rule uploads", () => {
  it("parses the documented JSON example", () => {
    const r = parseRulesJson(
      JSON.stringify({
        scoring_type: "h2h_categories",
        categories: ["FG%", "FT%", "3PM", "PTS", "REB", "AST", "STL", "BLK", "TO"],
        roster_slots: { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 2, UTIL: 2, BN: 3, IL: 2 },
        games_played_limit: null,
        max_adds_per_week: 4,
      }),
    );
    expect(r.categories).toHaveLength(9);
    expect(r.roster_slots.C).toBe(2);
    expect(r.week_start_day).toBe(1);
  });

  it("normalizes aliases (ST, 3PTM, Util, IR)", () => {
    const r = parseRulesJson(
      JSON.stringify({ scoring_type: "h2h_categories", categories: ["st", "3PTM"], roster_slots: { Util: 3, IR: 1 } }),
    );
    expect(r.categories).toEqual(["STL", "3PM"]);
    expect(r.roster_slots).toEqual({ UTIL: 3, IL: 1 });
  });

  it("parses a points league", () => {
    const r = parseRulesJson(
      JSON.stringify({ scoring_type: "h2h_points", point_weights: { PTS: 1, REB: 1.2, TO: -1 }, roster_slots: { UTIL: 10 } }),
    );
    expect(r.point_weights).toEqual({ PTS: 1, REB: 1.2, TO: -1 });
    expect(r.categories).toEqual([]);
  });

  it("reports every problem", () => {
    try {
      parseRulesJson(JSON.stringify({ scoring_type: "h2h_points", categories: ["XYZ"], roster_slots: { QB: 1 } }));
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(RulesFileError);
      const msg = (e as RulesFileError).problems.join(" | ");
      expect(msg).toMatch(/Unknown stat "XYZ"/);
    }
  });

  it("rejects a points league without weights", () => {
    expect(() => parseRulesJson(JSON.stringify({ scoring_type: "h2h_points", roster_slots: { UTIL: 10 } }))).toThrow(/point_weights/);
  });

  it("parses CSV", () => {
    const r = parseRulesCsv(
      ["type,key,value", "setting,scoring_type,h2h_points", "setting,games_played_limit,30", "point,PTS,1", "point,TO,-1", "slot,UTIL,10", "slot,BN,3"].join("\n"),
    );
    expect(r.scoring_type).toBe("h2h_points");
    expect(r.games_played_limit).toBe(30);
    expect(r.point_weights.TO).toBe(-1);
    expect(r.roster_slots.BN).toBe(3);
  });

  it("CSV errors name the row", () => {
    expect(() => parseRulesCsv("type,key,value\nsetting,scoring_type,roto\nslot,PG,two")).toThrow(/Row 3/);
  });
});
