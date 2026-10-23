import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, HttpError, requireLeague } from "@/lib/api";
import { activateRuleVersion } from "@/lib/data/rules";
import { runJob } from "@/lib/jobs/registry";

type Ctx = { params: Promise<{ id: string }> };

/** Roll this league back (or forward) to an existing rule version. */
export const POST = handler(async (req: Request, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  const { versionId } = z.object({ versionId: z.number().int() }).parse(await req.json());
  if (!(await activateRuleVersion(league.id, versionId))) throw new HttpError(404, "Version not found for this league");
  const runs = await runJob("values", league.id);
  return NextResponse.json({ ok: true, runs });
});
