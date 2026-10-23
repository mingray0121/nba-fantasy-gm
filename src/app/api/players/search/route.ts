import { NextResponse, type NextRequest } from "next/server";
import { ilike } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { handler, requireUser } from "@/lib/api";

export const GET = handler(async (req: NextRequest) => {
  await requireUser();
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ players: [] });
  const players = await getDb()
    .select({ id: schema.players.id, name: schema.players.fullName, positions: schema.players.eligiblePositions })
    .from(schema.players)
    .where(ilike(schema.players.fullName, `%${q.replace(/[%_]/g, "")}%`))
    .limit(15);
  return NextResponse.json({ players });
});
