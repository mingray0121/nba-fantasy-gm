import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { handler, HttpError, requireLeague } from "@/lib/api";
import { thisWeek } from "@/lib/data/model";
import { matchupView } from "@/lib/data/views";
import { addDays, today } from "@/lib/dates";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  return NextResponse.json(await matchupView(league.id));
});

const stats = z.record(z.string(), z.number().finite());
const input = z.object({
  // Side A; defaults to your team.
  teamId: z.number().int().optional(),
  opponentTeamId: z.number().int(),
  teamStats: stats.optional(),
  opponentStats: stats.optional(),
  teamPoints: z.number().finite().nullable().optional(),
  opponentPoints: z.number().finite().nullable().optional(),
  // The entered totals cover games through the end of this US Eastern date (default: yesterday).
  throughDate: z.iso.date().nullable().optional(),
});

/**
 * Manual leagues: set any matchup this week (two teams), plus optional totals copied from
 * Yahoo's matchup page through a given day. Later days are counted from box scores.
 */
export const PUT = handler(async (req: Request, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  if (league.source !== "manual") throw new HttpError(400, "Yahoo leagues sync their matchup from Yahoo");
  const body = input.parse(await req.json());
  const db = getDb();
  const teams = await db.select().from(schema.fantasyTeams).where(eq(schema.fantasyTeams.leagueId, league.id));
  const teamId = body.teamId ?? teams.find((t) => t.isMine)?.id;
  if (!teamId) throw new HttpError(400, "Mark one team as yours on the Roster page first");
  if (!teams.some((t) => t.id === teamId) || !teams.some((t) => t.id === body.opponentTeamId)) {
    throw new HttpError(400, "Pick two teams from this league");
  }
  if (teamId === body.opponentTeamId) throw new HttpError(400, "Pick two different teams");

  const { start, end, week } = await thisWeek(league.id);
  const hasBaseline =
    Object.keys(body.teamStats ?? {}).length > 0 ||
    Object.keys(body.opponentStats ?? {}).length > 0 ||
    body.teamPoints != null ||
    body.opponentPoints != null;
  const through = hasBaseline ? (body.throughDate ?? addDays(today(), -1)) : null;
  if (through && (through < addDays(start, -1) || through > end)) {
    throw new HttpError(400, `The totals date must be within this week (${start} to ${end})`);
  }

  // A team plays one matchup a week: reuse the row that already has this pair, and refuse
  // to put a team into a second matchup.
  const existing = await db
    .select()
    .from(schema.matchups)
    .where(and(eq(schema.matchups.leagueId, league.id), eq(schema.matchups.weekStart, start)));
  const pair = new Set([teamId, body.opponentTeamId]);
  const same = existing.find((m) => pair.has(m.teamId) && m.opponentTeamId != null && pair.has(m.opponentTeamId));
  const clash = existing.find((m) => m !== same && (pair.has(m.teamId) || (m.opponentTeamId != null && pair.has(m.opponentTeamId))));
  if (clash) {
    const busy = [clash.teamId, clash.opponentTeamId].find((id) => id != null && pair.has(id));
    throw new HttpError(400, `${teams.find((t) => t.id === busy)?.name ?? "That team"} already has a matchup this week`);
  }

  const values = {
    weekStart: start,
    weekEnd: end,
    teamId,
    opponentTeamId: body.opponentTeamId,
    baselineThrough: through,
    statsToDate: body.teamStats ?? {},
    opponentStatsToDate: body.opponentStats ?? {},
    pointsToDate: body.teamPoints ?? null,
    opponentPointsToDate: body.opponentPoints ?? null,
    updatedAt: new Date(),
  };
  if (same) {
    await db.update(schema.matchups).set(values).where(eq(schema.matchups.id, same.id));
  } else {
    await db.insert(schema.matchups).values({ leagueId: league.id, week, ...values });
  }
  await db.update(schema.leagues).set({ currentWeek: week }).where(eq(schema.leagues.id, league.id));
  return NextResponse.json({ ok: true, week });
});

/** Manual leagues: remove a matchup (?id=). */
export const DELETE = handler(async (req: NextRequest, { params }: Ctx) => {
  const league = await requireLeague((await params).id);
  if (league.source !== "manual") throw new HttpError(400, "Yahoo leagues sync their matchup from Yahoo");
  const id = Number(req.nextUrl.searchParams.get("id"));
  await getDb()
    .delete(schema.matchups)
    .where(and(eq(schema.matchups.id, id), eq(schema.matchups.leagueId, league.id)));
  return NextResponse.json({ ok: true });
});
