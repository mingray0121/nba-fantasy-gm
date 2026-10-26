import { NextResponse } from "next/server";
import { handler, requireLeague, requireOwner } from "@/lib/api";
import { refreshLeague } from "@/lib/jobs/registry";

type Ctx = { params: Promise<{ id: string }> };
export const maxDuration = 300;

/** The Refresh button: this league's roster, free agents, matchup and recommendations. */
export const POST = handler(async (_req: Request, { params }: Ctx) => {
  await requireOwner();
  const league = await requireLeague((await params).id);
  const runs = await refreshLeague(league.id);
  return NextResponse.json({ runs, ok: runs.every((r) => r.ok) });
});
