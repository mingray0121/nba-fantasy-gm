import { eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { YahooPlayer } from "../yahoo/parse";
import { matchPlayer, nbaTeamAbbr, type MatchCandidate } from "../players/match";

interface Candidate extends MatchCandidate {
  yahooPlayerKey: string | null;
}

/**
 * Resolves Yahoo players to rows in `players`, linking each to its NBA person
 * id (override table first, then name + team matching). Create one per job run
 * so the candidate list is loaded once.
 */
export class PlayerResolver {
  private byYahooKey = new Map<string, number>();
  private candidates: Candidate[] = [];
  private overrides = new Map<string, number>();
  private teamIdByAbbr = new Map<string, number>();
  private loaded = false;

  private async load() {
    if (this.loaded) return;
    const db = getDb();
    const teams = await db.select().from(schema.nbaTeams);
    const abbrById = new Map(teams.map((t) => [t.id, t.abbreviation]));
    for (const t of teams) this.teamIdByAbbr.set(t.abbreviation, t.id);
    const rows = await db
      .select({
        id: schema.players.id,
        name: schema.players.fullName,
        nbaTeamId: schema.players.nbaTeamId,
        yahooPlayerKey: schema.players.yahooPlayerKey,
        nbaPlayerId: schema.players.nbaPlayerId,
      })
      .from(schema.players);
    for (const r of rows) {
      if (r.yahooPlayerKey) this.byYahooKey.set(r.yahooPlayerKey, r.id);
      if (r.nbaPlayerId != null) {
        this.candidates.push({
          id: r.id,
          name: r.name,
          teamAbbr: r.nbaTeamId ? (abbrById.get(r.nbaTeamId) ?? null) : null,
          yahooPlayerKey: r.yahooPlayerKey,
        });
      }
    }
    const ov = await db.select().from(schema.playerIdOverrides).where(isNotNull(schema.playerIdOverrides.nbaPlayerId));
    for (const o of ov) this.overrides.set(o.yahooPlayerKey, o.nbaPlayerId);
    this.loaded = true;
  }

  /** Returns the players.id for a Yahoo player, creating or linking the row as needed. */
  async resolve(yp: YahooPlayer, opts: { updateFields?: boolean } = {}): Promise<number> {
    await this.load();
    const db = getDb();
    const teamAbbr = nbaTeamAbbr(yp.teamAbbr);
    const fields = {
      eligiblePositions: yp.eligiblePositions,
      yahooStatus: yp.status,
      headshotUrl: yp.headshotUrl,
      updatedAt: new Date(),
      ...(teamAbbr && this.teamIdByAbbr.has(teamAbbr) ? { nbaTeamId: this.teamIdByAbbr.get(teamAbbr)! } : {}),
    };

    const known = this.byYahooKey.get(yp.playerKey);
    if (known) {
      if (opts.updateFields === false) return known;
      await db.update(schema.players).set(fields).where(eq(schema.players.id, known));
      return known;
    }

    let targetId: number | null = null;
    const overrideNba = this.overrides.get(yp.playerKey);
    if (overrideNba != null) {
      const [row] = await db
        .select({ id: schema.players.id })
        .from(schema.players)
        .where(eq(schema.players.nbaPlayerId, overrideNba));
      targetId = row?.id ?? null;
    } else {
      const unlinked = this.candidates.filter((c) => !c.yahooPlayerKey);
      targetId = matchPlayer({ name: yp.fullName, teamAbbr }, unlinked)?.id ?? null;
    }

    if (targetId) {
      await db
        .update(schema.players)
        .set({ ...fields, yahooPlayerKey: yp.playerKey })
        .where(eq(schema.players.id, targetId));
      const c = this.candidates.find((x) => x.id === targetId);
      if (c) c.yahooPlayerKey = yp.playerKey;
    } else {
      // No NBA match yet (rookie with no games, or a name mismatch): keep a Yahoo-only row.
      const [row] = await db
        .insert(schema.players)
        .values({ ...fields, fullName: yp.fullName, yahooPlayerKey: yp.playerKey, nbaPlayerId: overrideNba ?? null })
        .returning({ id: schema.players.id });
      targetId = row.id;
    }
    this.byYahooKey.set(yp.playerKey, targetId);
    return targetId;
  }
}
