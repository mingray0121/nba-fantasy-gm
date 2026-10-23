/** Shared jobs: NBA facts and projections, the same for every league. */
import { and, eq, gte, inArray, isNotNull, lt, notInArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { InjuryStatus } from "@/db/schema";
import { espnAllRosters, fallbackSource, primarySource, type NbaBoxLine } from "../nba/client";
import { matchPlayer } from "../players/match";
import { computeWindows, type GameLog } from "../engine/projections";
import { today, addDays } from "../dates";
import { chunk, type JobResult } from "./run";

const COUNTED_GAME_TYPES = ["regular", "playin", "playoffs"];

/** Daily: season schedule and teams from the NBA CDN. */
export async function syncSchedule(): Promise<JobResult> {
  const db = getDb();
  const games = await primarySource().schedule();
  const teams = new Map<number, { nbaTeamId: number; abbreviation: string; name: string }>();
  for (const g of games) {
    teams.set(g.home.nbaTeamId, g.home);
    teams.set(g.away.nbaTeamId, g.away);
  }
  for (const t of teams.values()) {
    await db
      .insert(schema.nbaTeams)
      .values(t)
      .onConflictDoUpdate({ target: schema.nbaTeams.nbaTeamId, set: { abbreviation: t.abbreviation, name: t.name } });
  }
  const teamRows = await db.select().from(schema.nbaTeams);
  const teamId = new Map(teamRows.map((t) => [t.nbaTeamId, t.id]));

  const rows = games
    .filter((g) => g.gameType !== "preseason" && g.gameType !== "allstar" && g.gameDate)
    .map((g) => ({
      nbaGameId: g.nbaGameId,
      gameDate: g.gameDate,
      tipTime: g.tipTime,
      homeTeamId: teamId.get(g.home.nbaTeamId)!,
      awayTeamId: teamId.get(g.away.nbaTeamId)!,
      status: g.status,
      gameType: g.gameType,
    }));
  for (const batch of chunk(rows, 200)) {
    await db
      .insert(schema.nbaGames)
      .values(batch)
      .onConflictDoUpdate({
        target: schema.nbaGames.nbaGameId,
        set: {
          gameDate: sql`excluded.game_date`,
          tipTime: sql`excluded.tip_time`,
          // Never move a game back from final.
          status: sql`case when ${schema.nbaGames.status} = 'final' then 'final' else excluded.status end`,
        },
      });
  }
  return { rowsWritten: rows.length };
}

/** Nightly + catch-up: box scores for finished games that have no logs yet. */
export async function syncBoxScores(opts: { limit?: number } = {}): Promise<JobResult> {
  const db = getDb();
  const limit = opts.limit ?? 20;
  const logged = db.selectDistinct({ id: schema.playerGameLogs.gameId }).from(schema.playerGameLogs);
  const pending = await db
    .select()
    .from(schema.nbaGames)
    .where(
      and(
        lt(schema.nbaGames.gameDate, today()),
        inArray(schema.nbaGames.gameType, COUNTED_GAME_TYPES),
        notInArray(schema.nbaGames.id, logged),
      ),
    )
    .orderBy(schema.nbaGames.gameDate)
    .limit(limit);
  if (pending.length === 0) return { rowsWritten: 0, note: "No games waiting for box scores" };

  const teams = await db.select().from(schema.nbaTeams);
  const abbrById = new Map(teams.map((t) => [t.id, t.abbreviation]));
  const teamIdByAbbr = new Map(teams.map((t) => [t.abbreviation, t.id]));
  const allPlayers = await db
    .select({
      id: schema.players.id,
      nbaPlayerId: schema.players.nbaPlayerId,
      name: schema.players.fullName,
      nbaTeamId: schema.players.nbaTeamId,
    })
    .from(schema.players);
  const byNbaId = new Map(allPlayers.filter((p) => p.nbaPlayerId != null).map((p) => [p.nbaPlayerId!, p.id]));
  const yahooOnly = allPlayers
    .filter((p) => p.nbaPlayerId == null)
    .map((p) => ({ id: p.id, name: p.name, teamAbbr: p.nbaTeamId ? (abbrById.get(p.nbaTeamId) ?? null) : null }));
  const allCandidates = allPlayers.map((p) => ({
    id: p.id,
    name: p.name,
    teamAbbr: p.nbaTeamId ? (abbrById.get(p.nbaTeamId) ?? null) : null,
  }));

  const primary = primarySource();
  const fallback = fallbackSource();
  let written = 0;
  const failures: string[] = [];

  for (const game of pending) {
    let lines: NbaBoxLine[];
    try {
      lines = await primary.boxScore(game);
    } catch (err) {
      if (!fallback) {
        failures.push(`${game.nbaGameId}: ${(err as Error).message}`);
        continue;
      }
      try {
        lines = await fallback.boxScore({
          ...game,
          teams: [abbrById.get(game.homeTeamId)!, abbrById.get(game.awayTeamId)!],
        });
      } catch (err2) {
        failures.push(`${game.nbaGameId}: ${(err2 as Error).message}`);
        continue;
      }
    }
    if (lines.length === 0) continue; // not final yet

    const logRows = [];
    for (const l of lines) {
      let playerId: number | undefined;
      if (l.nbaPlayerId != null) {
        playerId = byNbaId.get(l.nbaPlayerId);
        if (!playerId) {
          // Link to a Yahoo-only row if one matches, else create the player.
          const match = matchPlayer({ name: l.name, teamAbbr: l.teamAbbr }, yahooOnly);
          if (match) {
            await db
              .update(schema.players)
              .set({ nbaPlayerId: l.nbaPlayerId, nbaTeamId: teamIdByAbbr.get(l.teamAbbr) ?? null })
              .where(eq(schema.players.id, match.id));
            playerId = match.id;
            yahooOnly.splice(yahooOnly.indexOf(match), 1);
          } else {
            const [row] = await db
              .insert(schema.players)
              .values({ nbaPlayerId: l.nbaPlayerId, fullName: l.name, nbaTeamId: teamIdByAbbr.get(l.teamAbbr) ?? null })
              .returning({ id: schema.players.id });
            playerId = row.id;
          }
          byNbaId.set(l.nbaPlayerId, playerId);
        }
      } else {
        playerId = matchPlayer({ name: l.name, teamAbbr: l.teamAbbr }, allCandidates)?.id;
        if (!playerId) continue;
      }
      logRows.push({
        playerId,
        gameId: game.id,
        gameDate: game.gameDate,
        minutes: l.minutes,
        pts: l.pts,
        reb: l.reb,
        oreb: l.oreb,
        dreb: l.dreb,
        ast: l.ast,
        stl: l.stl,
        blk: l.blk,
        tov: l.tov,
        fgm: l.fgm,
        fga: l.fga,
        ftm: l.ftm,
        fta: l.fta,
        fg3m: l.fg3m,
        fg3a: l.fg3a,
        pf: l.pf,
        plusMinus: l.plusMinus,
        dnpReason: l.dnpReason,
      });
    }
    for (const batch of chunk(logRows, 100)) {
      await db
        .insert(schema.playerGameLogs)
        .values(batch)
        .onConflictDoUpdate({
          target: [schema.playerGameLogs.playerId, schema.playerGameLogs.gameId],
          set: Object.fromEntries(
            ["minutes", "pts", "reb", "oreb", "dreb", "ast", "stl", "blk", "tov", "fgm", "fga", "ftm", "fta", "fg3m", "fg3a", "pf", "plus_minus", "dnp_reason"].map(
              (c) => [toCamel(c), sql.raw(`excluded.${c}`)],
            ),
          ),
        });
    }
    await db.update(schema.nbaGames).set({ status: "final" }).where(eq(schema.nbaGames.id, game.id));
    written += logRows.length;
  }
  return { rowsWritten: written, note: failures.length ? `Failed: ${failures.join("; ")}` : undefined };
}

function toCamel(s: string) {
  return s.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
}

/**
 * Injury status from Yahoo (collected by the roster and free agent syncs).
 * Statuses that cleared are removed.
 */
export async function syncInjuries(): Promise<JobResult> {
  const db = getDb();
  const flagged = await db
    .select({ id: schema.players.id, status: schema.players.yahooStatus })
    .from(schema.players)
    .where(isNotNull(schema.players.yahooStatus));
  const map: Record<string, InjuryStatus> = {
    O: "Out",
    INJ: "Out",
    "IL": "Out",
    "IL+": "Out",
    SUSP: "Out",
    GTD: "GTD",
    DTD: "DTD",
    Q: "Questionable",
    P: "Probable",
    D: "Doubtful",
  };
  let written = 0;
  const keep: number[] = [];
  for (const p of flagged) {
    const status = map[(p.status ?? "").toUpperCase()];
    if (!status) continue;
    keep.push(p.id);
    await db
      .insert(schema.playerInjuries)
      .values({ playerId: p.id, status, source: "yahoo", updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.playerInjuries.playerId,
        set: { status, source: "yahoo", updatedAt: new Date() },
      });
    written++;
  }
  await db
    .delete(schema.playerInjuries)
    .where(
      and(
        eq(schema.playerInjuries.source, "yahoo"),
        keep.length ? notInArray(schema.playerInjuries.playerId, keep) : sql`true`,
      ),
    );
  return { rowsWritten: written };
}

const ESPN_INJURY: Record<string, InjuryStatus> = {
  OUT: "Out",
  SUSPENSION: "Out",
  "DAY-TO-DAY": "DTD",
  DOUBTFUL: "Doubtful",
  QUESTIONABLE: "Questionable",
  PROBABLE: "Probable",
};

/**
 * Every NBA player from ESPN team rosters: names, teams, positions (only where
 * none are known yet) and injury status. Lets manual leagues pick any player
 * without Yahoo. Yahoo-sourced injuries win over ESPN ones.
 */
export async function syncPlayers(): Promise<JobResult> {
  const db = getDb();
  const roster = await espnAllRosters();
  const teams = await db.select().from(schema.nbaTeams);
  const teamIdByAbbr = new Map(teams.map((t) => [t.abbreviation, t.id]));
  const existing = await db
    .select({ id: schema.players.id, nbaPlayerId: schema.players.nbaPlayerId, positions: schema.players.eligiblePositions })
    .from(schema.players)
    .where(isNotNull(schema.players.nbaPlayerId));
  const byNbaId = new Map(existing.map((p) => [p.nbaPlayerId!, p]));

  const injured: { playerId: number; status: InjuryStatus }[] = [];
  for (const r of roster) {
    if (!r.nbaPlayerId || !r.name) continue;
    const nbaTeamId = teamIdByAbbr.get(r.teamAbbr) ?? null;
    const known = byNbaId.get(r.nbaPlayerId);
    let playerId: number;
    if (known) {
      await db
        .update(schema.players)
        .set({
          fullName: r.name,
          nbaTeamId,
          isActive: true,
          updatedAt: new Date(),
          ...(known.positions.length === 0 && r.positions.length ? { eligiblePositions: r.positions } : {}),
        })
        .where(eq(schema.players.id, known.id));
      playerId = known.id;
    } else {
      const [row] = await db
        .insert(schema.players)
        .values({ nbaPlayerId: r.nbaPlayerId, fullName: r.name, nbaTeamId, eligiblePositions: r.positions })
        .returning({ id: schema.players.id });
      playerId = row.id;
    }
    const status = r.injuryStatus ? ESPN_INJURY[r.injuryStatus.toUpperCase()] : undefined;
    if (status) injured.push({ playerId, status });
  }

  const yahooRows = await db
    .select({ playerId: schema.playerInjuries.playerId })
    .from(schema.playerInjuries)
    .where(eq(schema.playerInjuries.source, "yahoo"));
  const fromYahoo = new Set(yahooRows.map((r) => r.playerId));
  const espn = injured.filter((i) => !fromYahoo.has(i.playerId));
  for (const i of espn) {
    await db
      .insert(schema.playerInjuries)
      .values({ playerId: i.playerId, status: i.status, source: "espn", updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.playerInjuries.playerId,
        set: { status: i.status, source: "espn", updatedAt: new Date() },
      });
  }
  const keep = espn.map((i) => i.playerId);
  await db
    .delete(schema.playerInjuries)
    .where(
      and(
        eq(schema.playerInjuries.source, "espn"),
        keep.length ? notInArray(schema.playerInjuries.playerId, keep) : sql`true`,
      ),
    );
  return { rowsWritten: roster.length, note: `${espn.length} injured` };
}

/** After box scores: season / last-14 / last-7 per-game windows for every player who has played. */
export async function computeProjections(asOf = today()): Promise<JobResult> {
  const db = getDb();
  const seasonStart = addDays(asOf, -240);
  const logs = await db
    .select()
    .from(schema.playerGameLogs)
    .where(and(gte(schema.playerGameLogs.gameDate, seasonStart), lt(schema.playerGameLogs.gameDate, asOf)));
  const byPlayer = new Map<number, GameLog[]>();
  for (const l of logs) {
    const list = byPlayer.get(l.playerId) ?? [];
    list.push(l);
    byPlayer.set(l.playerId, list);
  }

  // Remaining regular-season games per NBA team.
  const remaining = await db
    .select({ teamId: schema.nbaTeams.id, n: sql<number>`count(${schema.nbaGames.id})::int` })
    .from(schema.nbaTeams)
    .leftJoin(
      schema.nbaGames,
      and(
        gte(schema.nbaGames.gameDate, asOf),
        eq(schema.nbaGames.gameType, "regular"),
        sql`(${schema.nbaGames.homeTeamId} = ${schema.nbaTeams.id} or ${schema.nbaGames.awayTeamId} = ${schema.nbaTeams.id})`,
      ),
    )
    .groupBy(schema.nbaTeams.id);
  const remainingByTeam = new Map(remaining.map((r) => [r.teamId, r.n]));
  const playerTeams = await db
    .select({ id: schema.players.id, teamId: schema.players.nbaTeamId })
    .from(schema.players)
    .where(inArray(schema.players.id, [...byPlayer.keys()].length ? [...byPlayer.keys()] : [-1]));
  const teamOf = new Map(playerTeams.map((p) => [p.id, p.teamId]));

  const rows = [];
  for (const [playerId, playerLogs] of byPlayer) {
    const w = computeWindows(playerLogs, addDays(asOf, -1));
    const gamesRemaining = remainingByTeam.get(teamOf.get(playerId) ?? -1) ?? 0;
    for (const horizon of ["season", "last14", "last7"] as const) {
      rows.push({ playerId, asOfDate: asOf, horizon, gamesInWindow: w[horizon].games, gamesRemaining, ...w[horizon].line });
    }
  }
  for (const batch of chunk(rows, 150)) {
    await db
      .insert(schema.playerProjections)
      .values(batch)
      .onConflictDoUpdate({
        target: [schema.playerProjections.playerId, schema.playerProjections.asOfDate, schema.playerProjections.horizon],
        set: Object.fromEntries(
          ["games_in_window", "minutes", "pts", "reb", "oreb", "dreb", "ast", "stl", "blk", "tov", "fgm", "fga", "ftm", "fta", "fg3m", "fg3a", "dd", "td", "pf", "plus_minus", "games_remaining"].map(
            (c) => [toCamel(c), sql.raw(`excluded.${c}`)],
          ),
        ),
      });
  }
  // Keep two weeks of history.
  await db.delete(schema.playerProjections).where(lt(schema.playerProjections.asOfDate, addDays(asOf, -14)));
  return { rowsWritten: rows.length };
}

/** Earliest tip-off on a day (Yahoo daily lineups lock per player at their tip). */
export async function firstTip(day = today()): Promise<Date | null> {
  const [row] = await getDb()
    .select({ tip: sql<string | null>`min(${schema.nbaGames.tipTime})` })
    .from(schema.nbaGames)
    .where(eq(schema.nbaGames.gameDate, day));
  return row?.tip ? new Date(row.tip) : null;
}
