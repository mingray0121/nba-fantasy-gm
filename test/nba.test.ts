import { describe, expect, it } from "vitest";
import { parseEspnBoxScore, parseEspnRoster, parseEspnSchedule } from "@/lib/nba/client";
import { matchPlayer, normalizeName, nbaTeamAbbr } from "@/lib/players/match";

describe("player matching", () => {
  it("normalizes accents, punctuation and suffixes", () => {
    expect(normalizeName("Luka Dončić")).toBe("luka doncic");
    expect(normalizeName("Jaren Jackson Jr.")).toBe("jaren jackson");
    expect(normalizeName("P.J. Washington")).toBe("pj washington");
  });

  it("maps Yahoo team abbreviations", () => {
    expect(nbaTeamAbbr("GS")).toBe("GSW");
    expect(nbaTeamAbbr("PHO")).toBe("PHX");
  });

  it("uses team to break name ties and refuses ambiguity", () => {
    const c = [
      { id: 1, name: "Jalen Williams", teamAbbr: "OKC" },
      { id: 2, name: "Jalen Williams", teamAbbr: "DEN" },
    ];
    expect(matchPlayer({ name: "Jalen Williams", teamAbbr: "OKC" }, c)?.id).toBe(1);
    expect(matchPlayer({ name: "Jalen Williams", teamAbbr: null }, c)).toBeNull();
  });
});

describe("ESPN parsing", () => {
  it("parses a team schedule with NBA tricodes and Eastern game dates", () => {
    const games = parseEspnSchedule({
      events: [
        {
          id: "401909092",
          date: "2026-10-22T02:00Z",
          seasonType: { type: 2 },
          competitions: [
            {
              status: { type: { state: "post" } },
              competitors: [
                { homeAway: "home", team: { id: "13", abbreviation: "LAL", displayName: "Los Angeles Lakers" } },
                { homeAway: "away", team: { id: "9", abbreviation: "GS", displayName: "Golden State Warriors" } },
              ],
            },
          ],
        },
      ],
    });
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ nbaGameId: "401909092", gameDate: "2026-10-21", status: "final", gameType: "regular" });
    expect(games[0].away).toEqual({ nbaTeamId: 9, abbreviation: "GSW", name: "Golden State Warriors" });
  });

  it("parses box scores, including DNPs", () => {
    const keys = [
      "minutes",
      "points",
      "fieldGoalsMade-fieldGoalsAttempted",
      "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
      "freeThrowsMade-freeThrowsAttempted",
      "rebounds",
      "assists",
      "turnovers",
      "steals",
      "blocks",
      "offensiveRebounds",
      "defensiveRebounds",
      "fouls",
      "plusMinus",
    ];
    const lines = parseEspnBoxScore({
      boxscore: {
        players: [
          {
            team: { abbreviation: "GS" },
            statistics: [
              {
                keys,
                athletes: [
                  {
                    athlete: { id: "4997536", displayName: "Gui Santos" },
                    stats: ["25", "12", "5-10", "1-3", "1-2", "5", "0", "0", "1", "0", "2", "3", "4", "-14"],
                  },
                  { athlete: { id: "1", displayName: "Bench Guy" }, stats: [], didNotPlay: true, reason: "COACH'S DECISION" },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(lines[0]).toMatchObject({
      nbaPlayerId: 4997536,
      teamAbbr: "GSW",
      minutes: 25,
      pts: 12,
      fgm: 5,
      fga: 10,
      fg3m: 1,
      fg3a: 3,
      ftm: 1,
      fta: 2,
      reb: 5,
      oreb: 2,
      dreb: 3,
      pf: 4,
      plusMinus: -14,
      dnpReason: null,
    });
    expect(lines[1]).toMatchObject({ minutes: 0, dnpReason: "COACH'S DECISION" });
  });
});

describe("ESPN rosters", () => {
  it("maps positions, tricodes and injuries", () => {
    const players = parseEspnRoster({
      team: { abbreviation: "GS" },
      athletes: [
        { id: "6589", fullName: "Draymond Green", position: { abbreviation: "F" }, injuries: [] },
        { id: "1", fullName: "Hurt Guard", position: { abbreviation: "G" }, injuries: [{ status: "Day-To-Day" }] },
      ],
    });
    expect(players[0]).toEqual({ nbaPlayerId: 6589, name: "Draymond Green", teamAbbr: "GSW", positions: ["SF", "PF"], injuryStatus: null });
    expect(players[1]).toMatchObject({ positions: ["PG", "SG"], injuryStatus: "Day-To-Day" });
  });
});

describe("ESPN career", () => {
  it("parses per-season and career averages, newest first", async () => {
    const { parseEspnCareer } = await import("@/lib/nba/client");
    const labels = ["GP", "GS", "MIN", "FG", "FG%", "3PT", "3P%", "FT", "FT%", "OR", "DR", "REB", "AST", "BLK", "STL", "PF", "TO", "PTS"];
    const rows = parseEspnCareer({
      categories: [
        {
          name: "averages",
          labels,
          statistics: [
            { season: { displayName: "2024-25" }, stats: ["70", "70", "32.2", "8.1-18.0", "44.8", "4.4-11.2", "39.7", "4.0-4.3", "93.3", "0.6", "3.9", "4.4", "6.0", "0.4", "1.1", "1.4", "2.9", "24.5"] },
            { season: { displayName: "2025-26" }, stats: ["43", "41", "30.9", "8.7-18.6", "46.8", "4.4-11.3", "39.3", "4.7-5.1", "92.3", "0.4", "3.2", "3.6", "4.7", "0.4", "1.1", "1.7", "2.8", "26.6"] },
          ],
          totals: ["1070", "1062", "34.0", "8.4-17.9", "47.1", "4.0-9.4", "42.2", "4.0-4.3", "91.2", "0.6", "4.0", "4.6", "6.3", "0.3", "1.5", "2.2", "3.1", "24.8"],
        },
      ],
    });
    expect(rows.map((r) => r.label)).toEqual(["2025-26", "2024-25", "Career"]);
    expect(rows[0]).toMatchObject({ gp: 43, pts: 26.6, fg3m: 4.4, tov: 2.8 });
    expect(rows[0].fgPct).toBeCloseTo(0.468);
  });
});
