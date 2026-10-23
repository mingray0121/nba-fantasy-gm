import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { handler, HttpError, requireLeague } from "@/lib/api";

type Ctx = { params: Promise<{ id: string; teamId: string }> };

async function manualTeam(ctx: Ctx) {
  const { id, teamId } = await ctx.params;
  const league = await requireLeague(id);
  if (league.source !== "manual") throw new HttpError(400, "Yahoo leagues sync their teams from Yahoo");
  const [team] = await getDb()
    .select()
    .from(schema.fantasyTeams)
    .where(and(eq(schema.fantasyTeams.id, Number(teamId)), eq(schema.fantasyTeams.leagueId, league.id)));
  if (!team) throw new HttpError(404, "Team not found");
  return { league, team };
}

/** Rename a team, or mark it as yours. */
export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const { league, team } = await manualTeam(ctx);
  const input = z.object({ name: z.string().trim().min(1).max(60).optional(), isMine: z.literal(true).optional() }).parse(await req.json());
  const db = getDb();
  if (input.isMine) {
    await db.update(schema.fantasyTeams).set({ isMine: false }).where(eq(schema.fantasyTeams.leagueId, league.id));
  }
  const [updated] = await db.update(schema.fantasyTeams).set(input).where(eq(schema.fantasyTeams.id, team.id)).returning();
  return NextResponse.json({ team: updated });
});

export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  const { team } = await manualTeam(ctx);
  if (team.isMine) throw new HttpError(400, "Mark another team as yours before deleting this one");
  await getDb().delete(schema.fantasyTeams).where(eq(schema.fantasyTeams.id, team.id));
  return NextResponse.json({ ok: true });
});
