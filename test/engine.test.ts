import { describe, expect, it } from "vitest";
import { optimizeLineup, slotAccepts } from "@/lib/engine/lineup";
import { buildCategoryScorer, pointsValue } from "@/lib/engine/values";
import { averageLogs, blendWindows, computeWindows, playProbability, type GameLog } from "@/lib/engine/projections";
import { projectCategories, matchupWeights } from "@/lib/engine/matchup";
import { suggestAddDrops } from "@/lib/engine/addDrop";
import { EMPTY_LINE, type StatLine } from "@/lib/stats";

const line = (o: Partial<StatLine>): StatLine => ({ ...EMPTY_LINE, ...o });

describe("lineup optimizer", () => {
  it("knows slot eligibility", () => {
    expect(slotAccepts("G", ["SG"])).toBe(true);
    expect(slotAccepts("F", ["C"])).toBe(false);
    expect(slotAccepts("UTIL", ["C"])).toBe(true);
  });

  it("fills more slots before chasing value", () => {
    // Best player is C-only; two C slots... but only PG and C slots.
    const res = optimizeLineup(
      [
        { playerId: 1, positions: ["PG", "SG"], value: 1, hasGame: true },
        { playerId: 2, positions: ["PG"], value: 5, hasGame: true },
        { playerId: 3, positions: ["C"], value: 3, hasGame: true },
      ],
      { PG: 1, SG: 1, C: 1, BN: 3 },
    );
    expect(res.starters).toBe(3);
    expect(res.assignments.get(2)).toBe("PG");
    expect(res.assignments.get(1)).toBe("SG");
    expect(res.assignments.get(3)).toBe("C");
  });

  it("benches players without a game and keeps IL players on IL", () => {
    const res = optimizeLineup(
      [
        { playerId: 1, positions: ["PG"], value: 9, hasGame: false },
        { playerId: 2, positions: ["PG"], value: 2, hasGame: true },
        { playerId: 3, positions: ["PG"], value: 0, hasGame: false, onInjuredList: true },
      ],
      { PG: 1, UTIL: 1 },
    );
    expect(res.assignments.get(1)).toBe("BN");
    expect(res.assignments.get(2)).not.toBe("BN");
    expect(res.assignments.get(3)).toBe("IL");
  });

  it("picks the higher-value player when slots are scarce", () => {
    const res = optimizeLineup(
      [
        { playerId: 1, positions: ["SF"], value: 2, hasGame: true },
        { playerId: 2, positions: ["SF", "PF"], value: 4, hasGame: true },
        { playerId: 3, positions: ["PF"], value: 3, hasGame: true },
      ],
      { F: 1, UTIL: 1 },
    );
    expect(res.assignments.get(1)).toBe("BN");
    expect(res.totalValue).toBe(7);
  });

  it("is exact where greedy fails", () => {
    // Greedy puts the 10-value G/F into G, leaving no F-eligible starter.
    const res = optimizeLineup(
      [
        { playerId: 1, positions: ["SG", "SF"], value: 10, hasGame: true },
        { playerId: 2, positions: ["PG"], value: 6, hasGame: true },
      ],
      { G: 1, F: 1 },
    );
    expect(res.starters).toBe(2);
    expect(res.assignments.get(1)).toBe("F");
    expect(res.assignments.get(2)).toBe("G");
  });
});

describe("values", () => {
  it("scores points leagues with weights", () => {
    expect(pointsValue(line({ pts: 20, reb: 10, tov: 3 }), { PTS: 1, REB: 1.2, TO: -1 })).toBeCloseTo(29);
  });

  it("z-scores categories with turnovers negative and FG% by impact", () => {
    const pool = [
      line({ pts: 10, tov: 1, fgm: 4, fga: 10 }),
      line({ pts: 20, tov: 3, fgm: 9, fga: 20 }),
      line({ pts: 30, tov: 2, fgm: 15, fga: 25 }),
    ];
    const score = buildCategoryScorer(pool, ["PTS", "TO", "FG%"]);
    const star = score(pool[2]);
    const low = score(pool[0]);
    expect(star.z.PTS).toBeGreaterThan(0);
    expect(low.z.TO).toBeGreaterThan(0); // fewest turnovers is good
    expect(star.z["FG%"]).toBeGreaterThan(low.z["FG%"]);
    expect(star.total).toBeGreaterThan(low.total);
  });

  it("drops punted categories", () => {
    const pool = [line({ pts: 10, ast: 1 }), line({ pts: 20, ast: 9 })];
    const s = buildCategoryScorer(pool, ["PTS", "AST"], { punt: ["AST"] })(pool[1]);
    expect(Object.keys(s.z)).toEqual(["PTS"]);
  });
});

describe("projections", () => {
  const log = (gameDate: string, minutes: number, pts: number): GameLog => ({ ...EMPTY_LINE, gameDate, minutes, pts });

  it("averages only games played and counts double-doubles", () => {
    const w = averageLogs([
      { ...log("2026-01-01", 30, 20), reb: 12 },
      log("2026-01-02", 0, 0),
    ]);
    expect(w.games).toBe(1);
    expect(w.line.dd).toBe(1);
  });

  it("weights recent minutes", () => {
    const logs = [
      ...Array.from({ length: 20 }, (_, i) => log(`2025-12-${String(i + 1).padStart(2, "0")}`, 20, 10)),
      ...Array.from({ length: 5 }, (_, i) => log(`2026-01-${String(i + 10).padStart(2, "0")}`, 36, 18)),
    ];
    const w = computeWindows(logs, "2026-01-15");
    const p = blendWindows(w);
    expect(p.minutes).toBeGreaterThan(w.season.line.minutes);
    expect(p.pts).toBeGreaterThan(w.season.line.pts);
  });

  it("maps statuses to play probability", () => {
    expect(playProbability("O")).toBe(0);
    expect(playProbability("GTD")).toBeCloseTo(0.6);
    expect(playProbability(null)).toBe(1);
  });
});

describe("matchup", () => {
  it("projects and classifies categories", () => {
    const res = projectCategories({
      categories: ["PTS", "TO", "FG%"],
      myToDate: { PTS: 300, TO: 30, FGM: 110, FGA: 240 },
      oppToDate: { PTS: 290, TO: 20, FGM: 100, FGA: 240 },
      myRemaining: line({ pts: 100, tov: 10, fgm: 40, fga: 85 }),
      oppRemaining: line({ pts: 100, tov: 10, fgm: 40, fga: 85 }),
      weekFractionLeft: 0.3,
    });
    const by = Object.fromEntries(res.map((r) => [r.key, r]));
    expect(by.PTS.state).toBe("close");
    expect(by.TO.state).toBe("losing");
    expect(by["FG%"].state).toBe("winning");
    const w = matchupWeights(res);
    expect(w.PTS).toBe(1.5);
  });
});

describe("add/drop", () => {
  it("pairs pickups with the weakest droppable players above the margin", () => {
    const p = (playerId: number, valuePerGame: number, extra = {}) => ({
      playerId,
      name: `P${playerId}`,
      valuePerGame,
      gamesThisWeek: 3,
      playProbability: 1,
      ...extra,
    });
    const s = suggestAddDrops(
      [p(1, 2), p(2, -1, { onInjuredList: true }), p(3, 0.5)],
      [p(10, 1.4), p(11, 3), p(12, 5, { playProbability: 0 })],
      0.5,
    );
    // P11 replaces P3; P10 (1.4) doesn't beat the next weakest (P1, 2.0); P12 is out; IL P2 is never dropped.
    expect(s.map((x) => [x.add.playerId, x.drop.playerId])).toEqual([[11, 3]]);
  });
});
