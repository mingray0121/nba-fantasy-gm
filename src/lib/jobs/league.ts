/** Per-league jobs. Each one touches exactly one league. */
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { YahooClient } from "../yahoo/client";
import { PlayerResolver } from "../data/players";
import { getActiveRules, sameRules, saveRuleVersion } from "../data/rules";
import { currentWeek, loadLeagueContext } from "../data/model";
import { addDropView, lineupView } from "../data/views";
import { round } from "../engine/values";
import { today, addDays } from "../dates";
import { chunk, type JobResult } from "./run";

type League = typeof schema.leagues.$inferSelect;

async function loadLeague(leagueId: number): Promise<League> {
  const [league] = await getDb().select().from(schema.leagues).where(eq(schema.leagues.id, leagueId));
  if (!league) throw new Error(`League ${leagueId} not found`);
  return league;
}

function yahooOnly(league: League): string | null {
  return league.source === "yahoo" ? league.yahooLeagueKey : null;
}

/** Rules and teams from Yahoo. A new rule version is saved only when something changed. */
export async function importRules(leagueId: number): Promise<JobResult> {
  const league = await loadLeague(leagueId);
  const key = yahooOnly(league);
  if (!key) return { rowsWritten: 0, note: "Manual league; rules come from uploads" };
  const yahoo = new YahooClient(league.userId);
  const { rules, meta, raw } = await yahoo.leagueSettings(key);

  await getDb()
    .update(schema.leagues)
    .set({
      name: meta.name ?? league.name,
      numTeams: meta.num_teams ? Number(meta.num_teams) : league.numTeams,
      currentWeek: meta.current_week ? Number(meta.current_week) : league.currentWeek,
    })
    .where(eq(schema.leagues.id, leagueId));

  let written = await syncTeams(leagueId, yahoo, key);
  const active = await getActiveRules(leagueId);
  if (!active || !sameRules(active.rules, rules)) {
    await saveRuleVersion(leagueId, rules, "yahoo_import", { raw });
    written++;
  }
  return { rowsWritten: written };
}

async function syncTeams(leagueId: number, yahoo: YahooClient, key: string): Promise<number> {
  const teams = await yahoo.teams(key);
  for (const t of teams) {
    await getDb()
      .insert(schema.fantasyTeams)
      .values({ leagueId, yahooTeamKey: t.teamKey, name: t.name, managerName: t.managerName, isMine: t.isMine })
      .onConflictDoUpdate({
        target: [schema.fantasyTeams.leagueId, schema.fantasyTeams.yahooTeamKey],
        set: { name: t.name, managerName: t.managerName, isMine: t.isMine },
      });
  }
  return teams.length;
}

/** Today's roster for every team in the league (opponents are needed for matchups and z-score pools). */
export async function syncRosters(leagueId: number, opts: { onlyMine?: boolean } = {}): Promise<JobResult> {
  const league = await loadLeague(leagueId);
  const key = yahooOnly(league);
  if (!key) return { rowsWritten: 0, note: "Manual league; edit the roster by hand" };
  const db = getDb();
  const yahoo = new YahooClient(league.userId);
  let teams = await db.select().from(schema.fantasyTeams).where(eq(schema.fantasyTeams.leagueId, leagueId));
  if (teams.length === 0) {
    await syncTeams(leagueId, yahoo, key);
    teams = await db.select().from(schema.fantasyTeams).where(eq(schema.fantasyTeams.leagueId, leagueId));
  }
  if (opts.onlyMine) teams = teams.filter((t) => t.isMine);

  const date = today();
  const resolver = new PlayerResolver();
  let written = 0;
  for (const team of teams) {
    if (!team.yahooTeamKey) continue;
    const roster = await yahoo.roster(team.yahooTeamKey, date);
    const rows: (typeof schema.rosterEntries.$inferInsert)[] = [];
    for (const yp of roster) {
      const playerId = await resolver.resolve(yp);
      rows.push({ leagueId, fantasyTeamId: team.id, playerId, date, slot: normalizeYahooSlot(yp.selectedPosition) });
    }
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.rosterEntries)
        .where(and(eq(schema.rosterEntries.fantasyTeamId, team.id), eq(schema.rosterEntries.date, date)));
      if (rows.length) await tx.insert(schema.rosterEntries).values(rows);
    });
    written += rows.length;
  }
  // Roster history older than 60 days isn't used.
  await db
    .delete(schema.rosterEntries)
    .where(and(eq(schema.rosterEntries.leagueId, leagueId), lt(schema.rosterEntries.date, addDays(date, -60))));
  return { rowsWritten: written };
}

function normalizeYahooSlot(pos: string | null): string {
  if (!pos) return "BN";
  if (pos === "Util") return "UTIL";
  if (pos === "IR") return "IL";
  if (pos === "IR+") return "IL+";
  return pos;
}

/** Top free agents (and waiver players) with ownership. */
export async function syncFreeAgents(leagueId: number, opts: { count?: number } = {}): Promise<JobResult> {
  const league = await loadLeague(leagueId);
  const key = yahooOnly(league);
  if (!key) return { rowsWritten: 0, note: "Manual league" };
  const yahoo = new YahooClient(league.userId);
  const resolver = new PlayerResolver();
  const takenAt = new Date();
  const total = opts.count ?? 100;
  const rows = [];
  for (const status of ["FA", "W"] as const) {
    const wanted = status === "FA" ? total : 25;
    for (let start = 0; start < wanted; start += 25) {
      const page = await yahoo.availablePlayers(key, status, start, 25);
      for (const [i, yp] of page.entries()) {
        rows.push({
          leagueId,
          playerId: await resolver.resolve(yp),
          takenAt,
          yahooRank: start + i + 1,
          percentOwned: yp.percentOwned,
          status,
        });
      }
      if (page.length < 25) break;
    }
  }
  const db = getDb();
  for (const batch of chunk(rows, 200)) await db.insert(schema.freeAgentSnapshots).values(batch);
  await db
    .delete(schema.freeAgentSnapshots)
    .where(and(eq(schema.freeAgentSnapshots.leagueId, leagueId), lt(schema.freeAgentSnapshots.takenAt, new Date(Date.now() - 3 * 86400000))));
  return { rowsWritten: rows.length };
}

/** This week's matchup score so far, plus recent transactions. */
export async function syncMatchup(leagueId: number): Promise<JobResult> {
  const league = await loadLeague(leagueId);
  const key = yahooOnly(league);
  if (!key) return { rowsWritten: 0, note: "Manual league" };
  const db = getDb();
  const yahoo = new YahooClient(league.userId);
  const teams = await db.select().from(schema.fantasyTeams).where(eq(schema.fantasyTeams.leagueId, leagueId));
  const byKey = new Map(teams.map((t) => [t.yahooTeamKey, t]));
  const mine = teams.find((t) => t.isMine);
  let written = 0;

  const board = await yahoo.scoreboard(key);
  for (const m of board) {
    const [a, b] = m.teams;
    for (const [me, them] of [
      [a, b],
      [b, a],
    ]) {
      const team = me && byKey.get(me.teamKey);
      if (!team || team.id !== mine?.id) continue;
      const opp = them ? byKey.get(them.teamKey) : undefined;
      const values = {
        leagueId,
        week: m.week,
        weekStart: m.weekStart,
        weekEnd: m.weekEnd,
        teamId: team.id,
        opponentTeamId: opp?.id ?? null,
        statsToDate: me.stats as Record<string, number>,
        opponentStatsToDate: (them?.stats ?? {}) as Record<string, number>,
        pointsToDate: me.points,
        opponentPointsToDate: them?.points ?? null,
        updatedAt: new Date(),
      };
      await db
        .insert(schema.matchups)
        .values(values)
        .onConflictDoUpdate({ target: [schema.matchups.leagueId, schema.matchups.week, schema.matchups.teamId], set: values });
      await db.update(schema.leagues).set({ currentWeek: m.week }).where(eq(schema.leagues.id, leagueId));
      written++;
    }
  }

  // Transactions are cheap and help explain roster changes.
  const resolver = new PlayerResolver();
  for (const t of await yahoo.transactions(key)) {
    const playerId = await resolver.resolve({
      playerKey: t.playerKey,
      fullName: t.playerName,
      teamAbbr: null,
      eligiblePositions: [],
      status: null,
      injuryNote: null,
      headshotUrl: null,
      selectedPosition: null,
      percentOwned: null,
    }, { updateFields: false }).catch(() => null);
    if (!playerId) continue;
    await db
      .insert(schema.transactions)
      .values({
        leagueId,
        yahooTransactionKey: t.transactionKey,
        type: t.type,
        playerId,
        teamId: t.teamKey ? (byKey.get(t.teamKey)?.id ?? null) : null,
        happenedAt: new Date(t.timestamp * 1000),
      })
      .onConflictDoNothing();
  }
  return { rowsWritten: written };
}

/** Per-league values for rostered players and free agents, then today's recommendations. */
export async function computeValues(leagueId: number): Promise<JobResult> {
  const db = getDb();
  const date = today();
  const ctx = await loadLeagueContext(leagueId, { date });
  const week = currentWeek(ctx, date);
  const games = await db
    .select({ home: schema.nbaGames.homeTeamId, away: schema.nbaGames.awayTeamId, day: schema.nbaGames.gameDate })
    .from(schema.nbaGames)
    .where(and(sql`${schema.nbaGames.gameDate} >= ${date}`, sql`${schema.nbaGames.gameDate} <= ${week.end}`));
  const gamesLeft = (teamId: number | null, onlyToday = false) =>
    teamId == null ? 0 : games.filter((g) => (g.home === teamId || g.away === teamId) && (!onlyToday || g.day === date)).length;

  const rows = [];
  for (const p of ctx.players.values()) {
    const base = { leagueId, playerId: p.id, asOfDate: date, valuePerGame: p.valuePerGame, categoryZ: p.categoryZ };
    const gToday = gamesLeft(p.nbaTeamId, true);
    const gWeek = gamesLeft(p.nbaTeamId);
    rows.push(
      { ...base, horizon: "next_game" as const, games: gToday, totalValue: round(p.valuePerGame * p.playProbability * gToday, 2) },
      { ...base, horizon: "rest_of_week" as const, games: gWeek, totalValue: round(p.valuePerGame * gWeek, 2) },
      { ...base, horizon: "rest_of_season" as const, games: p.gamesRemainingSeason, totalValue: round(p.valuePerGame * p.gamesRemainingSeason, 1) },
    );
  }
  for (const batch of chunk(rows, 200)) {
    await db
      .insert(schema.playerValues)
      .values(batch)
      .onConflictDoUpdate({
        target: [schema.playerValues.leagueId, schema.playerValues.playerId, schema.playerValues.asOfDate, schema.playerValues.horizon],
        set: {
          valuePerGame: sql`excluded.value_per_game`,
          categoryZ: sql`excluded.category_z`,
          games: sql`excluded.games`,
          totalValue: sql`excluded.total_value`,
        },
      });
  }
  await db
    .delete(schema.playerValues)
    .where(and(eq(schema.playerValues.leagueId, leagueId), lt(schema.playerValues.asOfDate, addDays(date, -14))));

  // Recommendations shown in the app (history kept per day).
  let recs = 0;
  if (ctx.myTeam) {
    const teamId = ctx.myTeam.id;
    const lineup = await lineupView(leagueId, date);
    const ad = await addDropView(leagueId);
    const recRows = [
      ...lineup.rows
        .filter((r) => r.action === "start" || r.action === "bench")
        .map((r) => ({
          leagueId,
          fantasyTeamId: teamId,
          forDate: date,
          type: r.action as "start" | "bench",
          playerId: r.playerId,
          slot: r.recommendedSlot,
          scoreDelta: r.value,
          reason: r.reason,
        })),
      ...ad.suggestions.flatMap((s) => [
        { leagueId, fantasyTeamId: teamId, forDate: date, type: "add" as const, playerId: s.add.playerId, pairedPlayerId: s.drop.playerId, scoreDelta: s.perGameGain, reason: s.reason },
        { leagueId, fantasyTeamId: teamId, forDate: date, type: "drop" as const, playerId: s.drop.playerId, pairedPlayerId: s.add.playerId, scoreDelta: s.perGameGain, reason: s.reason },
      ]),
    ];
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.recommendations)
        .where(and(eq(schema.recommendations.leagueId, leagueId), eq(schema.recommendations.forDate, date)));
      if (recRows.length) await tx.insert(schema.recommendations).values(recRows);
    });
    recs = recRows.length;
  }
  return { rowsWritten: rows.length + recs };
}
