import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { handler, HttpError, requireUser } from "@/lib/api";
import { listLeagues } from "@/lib/data/leagues";
import { saveRuleVersion } from "@/lib/data/rules";
import { runJob } from "@/lib/jobs/registry";
import { DEFAULT_RULES, validate } from "@/lib/rules/schema";
import { YahooClient } from "@/lib/yahoo/client";

export const maxDuration = 300;

export const GET = handler(async () => {
  const userId = await requireUser();
  return NextResponse.json({ leagues: await listLeagues(userId) });
});

const body = z.union([
  z.object({ yahooLeagueKey: z.string().min(3) }),
  z.object({
    manual: z.object({
      name: z.string().min(1),
      season: z.number().int(),
      rules: z.unknown().optional(),
    }),
  }),
]);

/** Connect a Yahoo league, or create a manual one. */
export const POST = handler(async (req: Request) => {
  const userId = await requireUser();
  const input = body.parse(await req.json());
  const db = getDb();

  if ("yahooLeagueKey" in input) {
    const available = await new YahooClient(userId).myLeagues();
    const yl = available.find((l) => l.leagueKey === input.yahooLeagueKey);
    if (!yl) throw new HttpError(404, "That league isn't in your Yahoo account");
    const [league] = await db
      .insert(schema.leagues)
      .values({
        userId,
        source: "yahoo",
        yahooLeagueKey: yl.leagueKey,
        season: yl.season,
        name: yl.name,
        numTeams: yl.numTeams,
        currentWeek: yl.currentWeek,
      })
      .onConflictDoUpdate({
        target: [schema.leagues.userId, schema.leagues.yahooLeagueKey],
        set: { isArchived: false, name: yl.name },
      })
      .returning();
    await db.insert(schema.leagueSettings).values({ leagueId: league.id }).onConflictDoNothing();
    // First pull: rules and teams, rosters, free agents, matchup, values.
    const runs = [];
    for (const job of ["rules-import", "roster-sync", "free-agents", "matchup-sync", "values"]) {
      runs.push(...(await runJob(job, league.id)));
    }
    return NextResponse.json({ league, runs }, { status: 201 });
  }

  const rules = input.manual.rules ? validate(input.manual.rules) : DEFAULT_RULES;
  const [league] = await db
    .insert(schema.leagues)
    .values({ userId, source: "manual", season: input.manual.season, name: input.manual.name })
    .returning();
  await db.insert(schema.leagueSettings).values({ leagueId: league.id }).onConflictDoNothing();
  await db.insert(schema.fantasyTeams).values({ leagueId: league.id, name: "My team", isMine: true });
  await saveRuleVersion(league.id, rules, input.manual.rules ? "file_upload" : "manual_edit");
  return NextResponse.json({ league }, { status: 201 });
});
