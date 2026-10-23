import { describe, expect, it } from "vitest";
import { parseCdnBoxScore, parseCdnSchedule, parseIsoMinutes } from "@/lib/nba/client";
import { matchPlayer, normalizeName, nbaTeamAbbr } from "@/lib/players/match";

describe("NBA CDN parsing", () => {
  it("parses ISO minutes", () => {
    expect(parseIsoMinutes("PT34M30.00S")).toBeCloseTo(34.5);
    expect(parseIsoMinutes("")).toBe(0);
  });

  it("parses the schedule, skipping TBD games", () => {
    const games = parseCdnSchedule({
      leagueSchedule: {
        gameDates: [
          {
            games: [
              {
                gameId: "0022600001",
                gameStatus: 1,
                gameDateEst: "2026-10-20T00:00:00Z",
                gameDateTimeUTC: "2026-10-20T23:30:00Z",
                homeTeam: { teamId: 1610612738, teamTricode: "BOS", teamCity: "Boston", teamName: "Celtics" },
                awayTeam: { teamId: 1610612752, teamTricode: "NYK", teamCity: "New York", teamName: "Knicks" },
              },
              { gameId: "0042600101", gameStatus: 1, homeTeam: { teamId: 0 }, awayTeam: { teamId: 0 } },
            ],
          },
        ],
      },
    });
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ gameDate: "2026-10-20", gameType: "regular", status: "scheduled" });
    expect(games[0].home.name).toBe("Boston Celtics");
  });

  it("parses box scores", () => {
    const lines = parseCdnBoxScore({
      game: {
        homeTeam: {
          teamTricode: "BOS",
          players: [
            { personId: 1628369, name: "Jayson Tatum", played: "1", statistics: { minutes: "PT36M00.00S", points: 30, reboundsTotal: 8, threePointersMade: 4, turnovers: 2, fieldGoalsMade: 11, fieldGoalsAttempted: 22 } },
            { personId: 1, name: "Bench Guy", played: "0", notPlayingReason: "INACTIVE_INJURY", statistics: {} },
          ],
        },
        awayTeam: { teamTricode: "NYK", players: [] },
      },
    });
    expect(lines[0]).toMatchObject({ nbaPlayerId: 1628369, teamAbbr: "BOS", minutes: 36, pts: 30, fg3m: 4, fga: 22 });
    expect(lines[1].dnpReason).toBe("INACTIVE_INJURY");
  });
});

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
