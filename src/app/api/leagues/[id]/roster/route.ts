import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { handler, HttpError, requireLeague } from "@/lib/api";
import { runJob } from "@/lib/jobs/registry";
import { today } from "@/lib/dates";
import { normalizeSlot } from "@/lib/rules/schema";

type Ctx = { params: Promise<{ id: string }> };

const input = z.object({
  players: z.array(z.object({ playerId: z.number().int(), slot: z.string(), positions: z.array(z.string()).optional() })).max(30),
});

/** Manual leagues: set your roster by hand (Yahoo leagues sync it automatically). */
export const PUT = handler(async (req: Request, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  if (league.source !== "manual") throw new HttpError(400, "Yahoo leagues sync their roster from Yahoo");
  const { players } = input.parse(await req.json());
  const db = getDb();
  const [team] = await db
    .select()
    .from(schema.fantasyTeams)
    .where(and(eq(schema.fantasyTeams.leagueId, league.id), eq(schema.fantasyTeams.isMine, true)));
  if (!team) throw new HttpError(400, "This league has no team marked as yours");
  const date = today();
  for (const p of players) {
    if (p.positions?.length) {
      await db.update(schema.players).set({ eligiblePositions: p.positions }).where(eq(schema.players.id, p.playerId));
    }
  }
  if (players.length) {
    const found = await db.select({ id: schema.players.id }).from(schema.players).where(inArray(schema.players.id, players.map((p) => p.playerId)));
    if (found.length !== new Set(players.map((p) => p.playerId)).size) throw new HttpError(400, "Unknown player id");
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.rosterEntries)
      .where(and(eq(schema.rosterEntries.fantasyTeamId, team.id), eq(schema.rosterEntries.date, date)));
    if (players.length) {
      await tx.insert(schema.rosterEntries).values(
        players.map((p) => ({ leagueId: league.id, fantasyTeamId: team.id, playerId: p.playerId, date, slot: normalizeSlot(p.slot) ?? "BN" })),
      );
    }
  });
  const runs = await runJob("values", league.id);
  return NextResponse.json({ ok: true, runs });
});
