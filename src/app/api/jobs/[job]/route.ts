import { NextResponse, type NextRequest } from "next/server";
import { handler, HttpError, requireJobToken } from "@/lib/api";
import { JOBS, runJob } from "@/lib/jobs/registry";

type Ctx = { params: Promise<{ job: string }> };
export const maxDuration = 300;

/** Called by GitHub Actions with `Authorization: Bearer $JOB_TOKEN`. Optional ?league=<id>. */
export const POST = handler(async (req: NextRequest, { params }: Ctx) => {
  requireJobToken(req);
  const { job } = await params;
  if (!JOBS[job]) throw new HttpError(404, `Unknown job ${job}`);
  const league = req.nextUrl.searchParams.get("league");
  const runs = await runJob(job, league ? Number(league) : undefined);
  const ok = runs.every((r) => r.ok);
  return NextResponse.json({ ok, runs }, { status: ok ? 200 : 500 });
});
