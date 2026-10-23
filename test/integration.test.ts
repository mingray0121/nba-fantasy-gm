/**
 * End-to-end check of the data layer against a real Postgres (no Yahoo, no NBA feeds):
 * seeds teams, games, box scores, two manual leagues, then runs projections, values
 * and every page's view. Runs only when TEST_DATABASE_URL points at a disposable
 * database with the migrations applied, e.g.
 *   TEST_DATABASE_URL=postgres://postgres@localhost/nfa_test npm test
 */
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("integration", () => {
  let m: {
    db: typeof import("@/db");
    rules: typeof import("@/lib/data/rules");
    shared: typeof import("@/lib/jobs/shared");
    league: typeof import("@/lib/jobs/league");
    views: typeof import("@/lib/data/views");
    dates: typeof import("@/lib/dates");
    schema: typeof import("@/lib/rules/schema");
  };
  const ids: { cats: number; points: number; me: number; opp: number; ptsMe: number } = { cats: 0, points: 0, me: 0, opp: 0, ptsMe: 0 };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    m = {
      db: await import("@/db"),
      rules: await import("@/lib/data/rules"),
      shared: await import("@/lib/jobs/shared"),
      league: await import("@/lib/jobs/league"),
      views: await import("@/lib/data/views"),
      dates: await import("@/lib/dates"),
      schema: await import("@/lib/rules/schema"),
    };
    const { getDb, schema: s } = m.db;
    const db = getDb();
    const { today, addDays } = m.dates;
    const t = today();

    await db.execute(
      `truncate users, nba_teams, players, nba_games, player_game_logs, player_projections, sync_runs restart identity cascade` as never,
    );
    const [user] = await db.insert(s.users).values({ yahooGuid: "TEST" }).returning();
    const teams = await db
      .insert(s.nbaTeams)
      .values(["BOS", "NYK", "LAL", "DEN"].map((a, i) => ({ nbaTeamId: 1000 + i, abbreviation: a, name: a })))
      .returning();

    // Games: every day for the last 20 days and the next 7, BOS-NYK on even days, LAL-DEN on odd days.
    const games = [];
    for (let d = -20; d <= 7; d++) {
      const day = addDays(t, d);
      const [h, a] = d % 2 === 0 ? [teams[0], teams[1]] : [teams[2], teams[3]];
      games.push({ nbaGameId: `00226${String(d + 100).padStart(5, "0")}`, gameDate: day, tipTime: new Date(`${day}T23:30:00Z`), homeTeamId: h.id, awayTeamId: a.id, status: d < 0 ? ("final" as const) : ("scheduled" as const) });
    }
    const gameRows = await db.insert(s.nbaGames).values(games).returning();

    // 24 players, 6 per team, with skill tiers.
    const positions = [["PG"], ["SG", "PG"], ["SF"], ["PF", "SF"], ["C"], ["C", "PF"]];
    const players = [];
    for (const [ti, team] of teams.entries()) {
      for (let k = 0; k < 6; k++) {
        players.push({ nbaPlayerId: 5000 + ti * 10 + k, fullName: `${team.abbreviation} Player ${k}`, nbaTeamId: team.id, eligiblePositions: positions[k] });
      }
    }
    const playerRows = await db.insert(s.players).values(players).returning();
    const logs = [];
    for (const g of gameRows.filter((g) => g.status === "final")) {
      for (const [i, p] of playerRows.entries()) {
        if (p.nbaTeamId !== g.homeTeamId && p.nbaTeamId !== g.awayTeamId) continue;
        const skill = 1 + (i % 6) * 0.25 + (i % 5) * 0.1;
        logs.push({
          playerId: p.id, gameId: g.id, gameDate: g.gameDate, minutes: 20 + skill * 6,
          pts: Math.round(8 * skill), reb: Math.round(3 * skill), ast: Math.round(2 * skill), stl: 1, blk: i % 3, tov: Math.round(skill),
          fgm: Math.round(3 * skill), fga: Math.round(7 * skill), ftm: 2, fta: 3, fg3m: i % 4, fg3a: (i % 4) + 2, oreb: 1, dreb: 2,
        });
      }
    }
    await db.insert(s.playerGameLogs).values(logs);
    await db.insert(s.playerInjuries).values({ playerId: playerRows[0].id, status: "Out", source: "test" });

    // Two leagues: categories and points, each with my team and an opponent.
    for (const kind of ["cats", "points"] as const) {
      const [lg] = await db.insert(s.leagues).values({ userId: user.id, source: "manual", season: 2026, name: kind }).returning();
      ids[kind] = lg.id;
      const rules =
        kind === "cats"
          ? m.schema.DEFAULT_RULES
          : m.schema.validate({ scoring_type: "h2h_points", point_weights: { PTS: 1, REB: 1.2, AST: 1.5, STL: 3, BLK: 3, TO: -1 }, roster_slots: { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 2, UTIL: 2, BN: 3, IL: 1 } });
      await m.rules.saveRuleVersion(lg.id, rules, "manual_edit");
      const [me, opp] = await db
        .insert(s.fantasyTeams)
        .values([{ leagueId: lg.id, name: "Me", isMine: true, yahooTeamKey: `${kind}.1` }, { leagueId: lg.id, name: "Them", yahooTeamKey: `${kind}.2` }])
        .returning();
      if (kind === "cats") {
        ids.me = me.id;
        ids.opp = opp.id;
      } else ids.ptsMe = me.id;
      const roster = playerRows.slice(0, 12).map((p, i) => ({ leagueId: lg.id, fantasyTeamId: i % 2 ? opp.id : me.id, playerId: p.id, date: t, slot: i < 4 ? "UTIL" : "BN" }));
      await db.insert(s.rosterEntries).values(roster);
      await db.insert(s.freeAgentSnapshots).values(playerRows.slice(12).map((p, i) => ({ leagueId: lg.id, playerId: p.id, takenAt: new Date("2026-01-01T00:00:00Z"), yahooRank: i + 1, status: "FA" as const })));
      const wk = m.dates.weekRange(t, 1);
      await db.insert(s.matchups).values({ leagueId: lg.id, week: 1, weekStart: wk.start, weekEnd: wk.end, teamId: me.id, opponentTeamId: opp.id, statsToDate: { PTS: 100, TO: 10 }, opponentStatsToDate: { PTS: 90, TO: 12 }, pointsToDate: 150, opponentPointsToDate: 140 });
    }
  });

  it("computes shared projections", async () => {
    const r = await m.shared.computeProjections();
    expect(r.rowsWritten).toBe(24 * 3);
  });

  it("computes values and recommendations per league", async () => {
    const a = await m.league.computeValues(ids.cats);
    const b = await m.league.computeValues(ids.points);
    expect(a.rowsWritten).toBeGreaterThan(0);
    expect(b.rowsWritten).toBeGreaterThan(0);
  });

  it("builds the Today view", async () => {
    const v = await m.views.lineupView(ids.cats);
    expect(v.rows).toHaveLength(6);
    const out = v.rows.find((r) => r.status === "Out");
    expect(out?.recommendedSlot).toBe("BN");
    for (const r of v.rows) if (!r.game) expect(r.recommendedSlot).toBe("BN");
  });

  it("builds the week, matchup, add/drop and player views", async () => {
    const w = await m.views.weekView(ids.points);
    expect(w.days).toHaveLength(7);
    expect(w.totalStarts).toBeGreaterThan(0);

    const cat = await m.views.matchupView(ids.cats);
    expect(cat.result?.kind).toBe("categories");
    const pts = await m.views.matchupView(ids.points);
    expect(pts.result?.kind).toBe("points");
    if (pts.result?.kind === "points") expect(pts.result.mine).toBeGreaterThan(150);

    const ad = await m.views.addDropView(ids.points);
    expect(ad.freeAgents.length).toBe(12);

    const pv = await m.views.playerView(1, ids.cats);
    expect(pv?.trends.season.games).toBeGreaterThan(0);
  });

  it("keeps rule versions isolated per league", async () => {
    await m.rules.saveRuleVersion(ids.cats, { ...m.schema.DEFAULT_RULES, categories: ["PTS", "REB"] }, "file_upload", { fileName: "x.json" });
    const a = await m.rules.listRuleVersions(ids.cats);
    const b = await m.rules.listRuleVersions(ids.points);
    expect(a.map((v) => v.version)).toEqual([2, 1]);
    expect(b.map((v) => v.version)).toEqual([1]);
    expect((await m.rules.getActiveRules(ids.cats))?.rules.categories).toEqual(["PTS", "REB"]);
    expect((await m.rules.getActiveRules(ids.points))?.rules.scoring_type).toBe("h2h_points");
  });
});
