import { NextResponse, type NextRequest } from "next/server";
import { handler, HttpError, requireLeague } from "@/lib/api";
import { nbaTeamView, nbaTeamsList } from "@/lib/data/nbaTeams";

type Ctx = { params: Promise<{ id: string }> };

/** All NBA teams, or one team's roster with ?team=ABBR. */
export const GET = handler(async (req: NextRequest, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  const abbr = req.nextUrl.searchParams.get("team");
  if (!abbr) return NextResponse.json({ teams: await nbaTeamsList() });
  const view = await nbaTeamView(league.id, abbr);
  if (!view) throw new HttpError(404, "Unknown NBA team");
  return NextResponse.json(view);
});
