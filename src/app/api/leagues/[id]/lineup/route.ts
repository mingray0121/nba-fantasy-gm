import { NextResponse, type NextRequest } from "next/server";
import { handler, requireLeague } from "@/lib/api";
import { lineupView } from "@/lib/data/views";
import { today } from "@/lib/dates";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req: NextRequest, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  const date = req.nextUrl.searchParams.get("date");
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today();
  return NextResponse.json(await lineupView(league.id, day));
});
