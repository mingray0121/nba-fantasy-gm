import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { handler, HttpError, requireLeague } from "@/lib/api";
import { getActiveRules } from "@/lib/data/rules";
import { matchupView } from "@/lib/data/views";
import { today, weekRange } from "@/lib/dates";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  return NextResponse.json(await matchupView(league.id));
});

const stats = z.record(z.string(), z.number().finite());
const input = z.object({
  opponentTeamId: z.number().int(),
  myStats: stats.optional(),
  opponentStats: stats.optional(),
  myPoints: z.number().finite().nullable().optional(),
  opponentPoints: z.number().finite().nullable().optional(),
});

/** Manual leagues: this week's opponent and the stats so far (copied from Yahoo's matchup page). */
export const PUT = handler(async (req: Request, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  if (league.source !== "manual") throw new HttpError(400, "Yahoo leagues sync their matchup from Yahoo");
  const body = input.parse(await req.json());
  const db = getDb();
  const teams = await db.select().from(schema.fantasyTeams).where(eq(schema.fantasyTeams.leagueId, league.id));
  const mine = teams.find((t) => t.isMine);
  if (!mine) throw new HttpError(400, "Mark one team as yours on the Roster page first");
  if (!teams.some((t) => t.id === body.opponentTeamId && !t.isMine)) throw new HttpError(400, "Pick an opponent from this league");

  const rules = (await getActiveRules(league.id))?.rules;
  const { start, end } = weekRange(today(), rules?.week_start_day ?? 1);
  // Week number counted from the week of the first regular-season game.
  const [first] = await db
    .select({ day: schema.nbaGames.gameDate })
    .from(schema.nbaGames)
    .where(eq(schema.nbaGames.gameType, "regular"))
    .orderBy(asc(schema.nbaGames.gameDate))
    .limit(1);
  const firstStart = first ? weekRange(first.day, rules?.week_start_day ?? 1).start : start;
  const week = Math.max(1, Math.round((Date.parse(start) - Date.parse(firstStart)) / (7 * 86400000)) + 1);

  const values = {
    weekStart: start,
    weekEnd: end,
    opponentTeamId: body.opponentTeamId,
    statsToDate: body.myStats ?? {},
    opponentStatsToDate: body.opponentStats ?? {},
    pointsToDate: body.myPoints ?? null,
    opponentPointsToDate: body.opponentPoints ?? null,
    updatedAt: new Date(),
  };
  await db
    .insert(schema.matchups)
    .values({ leagueId: league.id, week, teamId: mine.id, ...values })
    .onConflictDoUpdate({ target: [schema.matchups.leagueId, schema.matchups.week, schema.matchups.teamId], set: values });
  await db.update(schema.leagues).set({ currentWeek: week }).where(and(eq(schema.leagues.id, league.id)));
  return NextResponse.json({ ok: true, week });
});
