import { NextResponse, type NextRequest } from "next/server";
import { handler, HttpError, requireLeague, requireUser } from "@/lib/api";
import { playerView } from "@/lib/data/views";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req: NextRequest, { params }: Ctx) => {
  await requireUser();
  const leagueParam = req.nextUrl.searchParams.get("league");
  const league = leagueParam ? await requireLeague(leagueParam) : null;
  const view = await playerView(Number((await params).id), league?.id);
  if (!view) throw new HttpError(404, "Player not found");
  return NextResponse.json(view);
});
