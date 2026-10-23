import { NextResponse } from "next/server";
import { handler, requireLeague } from "@/lib/api";
import { matchupView } from "@/lib/data/views";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  return NextResponse.json(await matchupView(league.id));
});
