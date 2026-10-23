import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { handler, requireLeague } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  return NextResponse.json({ league });
});

/** Rename or archive a league. */
export const PATCH = handler(async (req: Request, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  const input = z.object({ name: z.string().min(1).optional(), isArchived: z.boolean().optional() }).parse(await req.json());
  const [updated] = await getDb().update(schema.leagues).set(input).where(eq(schema.leagues.id, league.id)).returning();
  return NextResponse.json({ league: updated });
});
