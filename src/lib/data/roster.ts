/** Manual leagues: editing team rosters by hand. */
import { and, eq, inArray, lte, max, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { HttpError } from "../api";
import { today } from "../dates";
import { normalizeSlot } from "../rules/schema";

export interface RosterInput {
  playerId: number;
  slot: string;
}

/** A team's latest roster on or before today. */
export async function currentTeamRoster(teamId: number): Promise<RosterInput[]> {
  const db = getDb();
  const [{ date }] = await db
    .select({ date: max(schema.rosterEntries.date) })
    .from(schema.rosterEntries)
    .where(and(eq(schema.rosterEntries.fantasyTeamId, teamId), lte(schema.rosterEntries.date, today())));
  if (!date) return [];
  return db
    .select({ playerId: schema.rosterEntries.playerId, slot: schema.rosterEntries.slot })
    .from(schema.rosterEntries)
    .where(and(eq(schema.rosterEntries.fantasyTeamId, teamId), eq(schema.rosterEntries.date, date)));
}

/** Throws when a player doesn't exist or is already on another team in the league. */
export async function assertPlayersAvailable(leagueId: number, teamId: number, playerIds: number[]) {
  if (playerIds.length === 0) return;
  const db = getDb();
  const found = await db.select({ id: schema.players.id }).from(schema.players).where(inArray(schema.players.id, playerIds));
  if (found.length !== new Set(playerIds).size) throw new HttpError(400, "Unknown player id");
  const [{ latest }] = await db
    .select({ latest: max(schema.rosterEntries.date) })
    .from(schema.rosterEntries)
    .where(and(eq(schema.rosterEntries.leagueId, leagueId), lte(schema.rosterEntries.date, today())));
  if (!latest) return;
  const taken = await db
    .select({ name: schema.players.fullName, team: schema.fantasyTeams.name })
    .from(schema.rosterEntries)
    .innerJoin(schema.fantasyTeams, eq(schema.fantasyTeams.id, schema.rosterEntries.fantasyTeamId))
    .innerJoin(schema.players, eq(schema.players.id, schema.rosterEntries.playerId))
    .where(
      and(
        eq(schema.rosterEntries.leagueId, leagueId),
        ne(schema.rosterEntries.fantasyTeamId, teamId),
        eq(schema.rosterEntries.date, latest),
        inArray(schema.rosterEntries.playerId, playerIds),
      ),
    );
  if (taken.length) throw new HttpError(400, `Already on another team: ${taken.map((t) => `${t.name} (${t.team})`).join(", ")}`);
}

/**
 * Replaces one team's roster for today. The model reads every team's roster
 * from the league's latest date, so the other teams' latest rosters are
 * brought forward to today first.
 */
export async function replaceTeamRoster(leagueId: number, teamId: number, players: RosterInput[]) {
  const date = today();
  await getDb().transaction(async (tx) => {
    const others = await tx
      .select({ id: schema.fantasyTeams.id })
      .from(schema.fantasyTeams)
      .where(and(eq(schema.fantasyTeams.leagueId, leagueId), ne(schema.fantasyTeams.id, teamId)));
    for (const other of others) {
      const [{ latest }] = await tx
        .select({ latest: max(schema.rosterEntries.date) })
        .from(schema.rosterEntries)
        .where(and(eq(schema.rosterEntries.fantasyTeamId, other.id), lte(schema.rosterEntries.date, date)));
      if (!latest || latest === date) continue;
      const rows = await tx
        .select()
        .from(schema.rosterEntries)
        .where(and(eq(schema.rosterEntries.fantasyTeamId, other.id), eq(schema.rosterEntries.date, latest)));
      if (rows.length) {
        await tx.insert(schema.rosterEntries).values(rows.map(({ id: _id, ...r }) => ({ ...r, date })));
      }
    }
    await tx
      .delete(schema.rosterEntries)
      .where(and(eq(schema.rosterEntries.fantasyTeamId, teamId), eq(schema.rosterEntries.date, date)));
    if (players.length) {
      await tx.insert(schema.rosterEntries).values(
        players.map((p) => ({ leagueId, fantasyTeamId: teamId, playerId: p.playerId, date, slot: normalizeSlot(p.slot) ?? "BN" })),
      );
    }
  });
}
