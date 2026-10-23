import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { handler, requireLeague } from "@/lib/api";
import { getLeagueSettings } from "@/lib/data/model";
import { runJob } from "@/lib/jobs/registry";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  return NextResponse.json({ settings: await getLeagueSettings(league.id) });
});

const input = z.object({
  windowWeights: z
    .object({ season: z.number().min(0), last14: z.number().min(0), last7: z.number().min(0) })
    .refine((w) => w.season + w.last14 + w.last7 > 0, "At least one window needs weight"),
  puntCategories: z.array(z.string()),
  dropMargin: z.number().min(0).max(20),
  matchupAware: z.boolean(),
});

export const PUT = handler(async (req: Request, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  const s = input.parse(await req.json());
  const total = s.windowWeights.season + s.windowWeights.last14 + s.windowWeights.last7;
  const values = {
    leagueId: league.id,
    ...s,
    windowWeights: {
      season: s.windowWeights.season / total,
      last14: s.windowWeights.last14 / total,
      last7: s.windowWeights.last7 / total,
    },
  };
  await getDb()
    .insert(schema.leagueSettings)
    .values(values)
    .onConflictDoUpdate({ target: schema.leagueSettings.leagueId, set: values });
  const runs = await runJob("values", league.id);
  return NextResponse.json({ settings: values, runs });
});
