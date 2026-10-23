import { NextResponse } from "next/server";
import { handler, requireLeague } from "@/lib/api";
import { getActiveRules, listRuleVersions, saveRuleVersion } from "@/lib/data/rules";
import { runJob } from "@/lib/jobs/registry";
import { toRulesInput, validate } from "@/lib/rules/schema";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  const active = await getActiveRules(league.id);
  return NextResponse.json({
    active: active ? { ...active, input: toRulesInput(active.rules) } : null,
    versions: await listRuleVersions(league.id),
  });
});

/** Saves edited rules as a new version for this league, then recomputes only this league. */
export const PUT = handler(async (req: Request, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  const rules = validate(await req.json());
  const versionId = await saveRuleVersion(league.id, rules, "manual_edit");
  const runs = await runJob("values", league.id);
  return NextResponse.json({ versionId, runs });
});
