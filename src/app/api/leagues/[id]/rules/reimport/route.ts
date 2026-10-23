import { NextResponse } from "next/server";
import { handler, requireLeague } from "@/lib/api";
import { runJob } from "@/lib/jobs/registry";

type Ctx = { params: Promise<{ id: string }> };
export const maxDuration = 300;

/** Re-pull this league's rules from Yahoo (a new version is saved only if they changed). */
export const POST = handler(async (_req: Request, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  const runs = [...(await runJob("rules-import", league.id)), ...(await runJob("values", league.id))];
  return NextResponse.json({ runs });
});
