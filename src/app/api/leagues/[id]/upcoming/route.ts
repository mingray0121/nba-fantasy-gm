import { NextResponse } from "next/server";
import { handler, requireLeague } from "@/lib/api";
import { upcomingView } from "@/lib/data/upcoming";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req: Request, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  return NextResponse.json(await upcomingView(league.id, new URL(req.url).searchParams.get("date")));
});
