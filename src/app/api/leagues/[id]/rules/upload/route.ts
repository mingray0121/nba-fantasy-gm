import { NextResponse } from "next/server";
import { handler, HttpError, requireLeague } from "@/lib/api";
import { saveRuleVersion } from "@/lib/data/rules";
import { runJob } from "@/lib/jobs/registry";
import { parseRulesCsv, parseRulesJson, RulesFileError } from "@/lib/rules/schema";

type Ctx = { params: Promise<{ id: string }> };

/** multipart/form-data with a `file` field (.json or .csv). */
export const POST = handler(async (req: Request, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Attach a .json or .csv file as `file`");
  if (file.size > 100_000) throw new HttpError(400, "Rule files must be under 100 KB");
  const text = await file.text();
  const isCsv = file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";
  try {
    const rules = isCsv ? parseRulesCsv(text) : parseRulesJson(text);
    const versionId = await saveRuleVersion(league.id, rules, "file_upload", { fileName: file.name, raw: text });
    const runs = await runJob("values", league.id);
    return NextResponse.json({ versionId, rules, runs });
  } catch (err) {
    if (err instanceof RulesFileError) {
      return NextResponse.json({ error: "The file has problems", problems: err.problems }, { status: 400 });
    }
    throw err;
  }
});
