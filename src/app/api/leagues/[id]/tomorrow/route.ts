import { NextResponse } from "next/server";
import { handler, requireLeague } from "@/lib/api";
import { tomorrowView } from "@/lib/data/tomorrow";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  return NextResponse.json(await tomorrowView(league.id));
});
