import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { handler, HttpError, requireLeague } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  const teams = await getDb()
    .select()
    .from(schema.fantasyTeams)
    .where(eq(schema.fantasyTeams.leagueId, league.id))
    .orderBy(schema.fantasyTeams.id);
  return NextResponse.json({ teams });
});

/** Manual leagues: add another team (opponents, for free agents and matchups). */
export const POST = handler(async (req: Request, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  if (league.source !== "manual") throw new HttpError(400, "Yahoo leagues sync their teams from Yahoo");
  const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(await req.json());
  const [team] = await getDb().insert(schema.fantasyTeams).values({ leagueId: league.id, name }).returning();
  return NextResponse.json({ team }, { status: 201 });
});
