import { describe, expect, it } from "vitest";
import { parseLeagueSettings, parseRoster, parseScoreboard, parseTeams, parseUserLeagues, yList, yMerge } from "@/lib/yahoo/parse";

// Fixtures follow the shape of Yahoo Fantasy API responses with format=json.
const settingsBody = {
  fantasy_content: {
    league: [
      { league_key: "466.l.1234", name: "Office League", num_teams: 12, current_week: 2, scoring_type: "head", season: "2026" },
      {
        settings: [
          {
            max_weekly_adds: "4",
            roster_positions: [
              { roster_position: { position: "PG", count: 1 } },
              { roster_position: { position: "SG", count: 1 } },
              { roster_position: { position: "G", count: 1 } },
              { roster_position: { position: "Util", count: 2 } },
              { roster_position: { position: "C", count: 2 } },
              { roster_position: { position: "BN", count: 3 } },
              { roster_position: { position: "IL", count: 2 } },
            ],
            stat_categories: {
              stats: [
                { stat: { stat_id: 9004003, enabled: "1", display_name: "FGM/A", is_only_display_stat: "1" } },
                { stat: { stat_id: 5, enabled: "1", display_name: "FG%" } },
                { stat: { stat_id: 10, enabled: "1", display_name: "3PTM" } },
                { stat: { stat_id: 12, enabled: "1", display_name: "PTS" } },
                { stat: { stat_id: 17, enabled: "1", display_name: "ST" } },
                { stat: { stat_id: 19, enabled: "1", display_name: "TO" } },
              ],
            },
          },
        ],
      },
    ],
  },
};

describe("yahoo json helpers", () => {
  it("lists and merges", () => {
    expect(yList({ 0: "a", 1: "b", count: 2 })).toEqual(["a", "b"]);
    expect(yMerge([{ a: 1 }, [{ b: 2 }], []])).toEqual({ a: 1, b: 2 });
  });
});

describe("league settings", () => {
  it("builds category rules, skipping display-only stats", () => {
    const { rules, meta } = parseLeagueSettings(settingsBody);
    expect(meta.name).toBe("Office League");
    expect(rules.scoring_type).toBe("h2h_categories");
    expect(rules.categories).toEqual(["FG%", "3PM", "PTS", "STL", "TO"]);
    expect(rules.roster_slots).toEqual({ PG: 1, SG: 1, G: 1, UTIL: 2, C: 2, BN: 3, IL: 2 });
    expect(rules.max_adds_per_week).toBe(4);
  });

  it("builds points rules from stat modifiers", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = structuredClone(settingsBody) as any;
    body.fantasy_content.league[0].scoring_type = "headpoint";
    body.fantasy_content.league[1].settings[0].stat_modifiers = {
      stats: [
        { stat: { stat_id: 12, value: "1" } },
        { stat: { stat_id: 17, value: "3" } },
        { stat: { stat_id: 19, value: "-1" } },
      ],
    };
    const { rules } = parseLeagueSettings(body);
    expect(rules.scoring_type).toBe("h2h_points");
    expect(rules.point_weights).toEqual({ PTS: 1, STL: 3, TO: -1 });
  });
});

describe("leagues, teams, rosters, scoreboard", () => {
  it("parses user leagues", () => {
    const body = {
      fantasy_content: {
        users: {
          0: {
            user: [
              { guid: "ABC" },
              {
                games: {
                  0: {
                    game: [
                      { game_key: "466", code: "nba" },
                      { leagues: { 0: { league: [{ league_key: "466.l.1", name: "A", season: "2026", num_teams: 10, current_week: 1, scoring_type: "headpoint" }] }, count: 1 } },
                    ],
                  },
                  count: 1,
                },
              },
            ],
          },
          count: 1,
        },
      },
    };
    expect(parseUserLeagues(body)).toEqual([
      { leagueKey: "466.l.1", name: "A", season: 2026, numTeams: 10, currentWeek: 1, scoringType: "headpoint" },
    ]);
  });

  it("finds my team", () => {
    const body = {
      fantasy_content: {
        league: [
          {},
          {
            teams: {
              0: { team: [[{ team_key: "466.l.1.t.1" }, { name: "Mine" }, { is_owned_by_current_login: 1 }, { managers: [{ manager: { nickname: "Ray" } }] }]] },
              1: { team: [[{ team_key: "466.l.1.t.2" }, { name: "Theirs" }, { managers: [{ manager: { nickname: "Sam" } }] }]] },
              count: 2,
            },
          },
        ],
      },
    };
    const teams = parseTeams(body);
    expect(teams.map((t) => [t.name, t.isMine, t.managerName])).toEqual([
      ["Mine", true, "Ray"],
      ["Theirs", false, "Sam"],
    ]);
  });

  it("parses a roster with selected positions", () => {
    const body = {
      fantasy_content: {
        team: [
          [{ team_key: "t" }],
          {
            roster: {
              0: {
                players: {
                  0: {
                    player: [
                      [
                        { player_key: "466.p.6014" },
                        { name: { full: "Luka Dončić" } },
                        { status: "GTD" },
                        { editorial_team_abbr: "LAL" },
                        { eligible_positions: [{ position: "PG" }, { position: "SG" }, { position: "G" }, { position: "Util" }] },
                        { headshot: { url: "https://s.yimg.com/x.png" } },
                      ],
                      { selected_position: [{ coverage_type: "date" }, { position: "PG" }] },
                    ],
                  },
                  count: 1,
                },
              },
            },
          },
        ],
      },
    };
    const [p] = parseRoster(body);
    expect(p).toMatchObject({ playerKey: "466.p.6014", fullName: "Luka Dončić", status: "GTD", teamAbbr: "LAL", selectedPosition: "PG" });
    expect(p.eligiblePositions).toEqual(["PG", "SG", "G"]);
  });

  it("parses scoreboard stats including made/attempted pairs", () => {
    const team = (key: string, stats: [number, string][], points: string) => ({
      team: [
        [{ team_key: key }],
        { team_stats: { stats: stats.map(([id, value]) => ({ stat: { stat_id: id, value } })) }, team_points: { total: points } },
      ],
    });
    const body = {
      fantasy_content: {
        league: [
          {},
          {
            scoreboard: {
              0: {
                matchups: {
                  0: {
                    matchup: {
                      week: "2",
                      week_start: "2026-10-26",
                      week_end: "2026-11-01",
                      0: { teams: { 0: team("a", [[9004003, "45/98"], [5, ".459"], [12, "210"]], "0"), 1: team("b", [[12, "190"]], "0"), count: 2 } },
                    },
                  },
                  count: 1,
                },
              },
            },
          },
        ],
      },
    };
    const [m] = parseScoreboard(body);
    expect(m.week).toBe(2);
    expect(m.teams[0].stats).toMatchObject({ FGM: 45, FGA: 98, "FG%": 0.459, PTS: 210 });
  });
});
