/** The Suggestions page: today's lineup moves, free-agent swaps and trade ideas. */
import { and, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { currentWeek, loadLeagueContext } from "./model";
import { addDropView, lineupView, weekView } from "./views";
import { findTrades, type TradeTeam } from "../engine/trades";
import { INJURED_SLOTS, type Slot } from "../rules/schema";
import { toLocalDate } from "../dates";

const OUT = new Set(["O", "OUT", "INJ", "SUSP", "IL", "IL+", "NA"]);

export async function suggestionsView(leagueId: number) {
  const [lineup, week, addDrop, ctx] = await Promise.all([
    lineupView(leagueId),
    weekView(leagueId),
    addDropView(leagueId),
    loadLeagueContext(leagueId),
  ]);

  // Part 1: today's changes, and remaining days where a player with a game has no slot.
  const changes = lineup.rows.filter((r) => r.action !== "keep");
  const today = lineup.date;
  const days = week.days
    .filter((d) => d >= today)
    .map((d) => ({
      day: d,
      starts: (week.startsByDay as Record<string, number>)[d] ?? 0,
      benchedWithGame: week.players.filter((p) => p.days[d]?.game && p.days[d]?.slot === "BN").map((p) => p.name),
    }));

  // Part 2A: free-agent swaps by rest-of-week gain, and adds left this week.
  const adds = ctx.myTeam ? await addsThisWeek(leagueId, ctx.myTeam.id, currentWeek(ctx)) : 0;
  const maxAdds = ctx.rules.max_adds_per_week;
  const addsLeft = maxAdds == null ? null : Math.max(0, maxAdds - adds);
  const freeAgentSwaps = addsLeft === 0 ? [] : [...addDrop.suggestions].sort((a, b) => b.restOfWeekGain - a.restOfWeekGain).slice(0, 5);

  // Part 2B: trades with other teams (category leagues only).
  let trades: ReturnType<typeof findTrades> = [];
  if (ctx.myTeam && ctx.rules.scoring_type !== "h2h_points") {
    const teams: TradeTeam[] = ctx.teams.map((t) => ({
      teamId: t.id,
      name: t.name,
      players: ctx.roster
        .filter((r) => r.fantasyTeamId === t.id)
        .map((r) => {
          const p = ctx.players.get(r.playerId);
          const status = (p?.injuryStatus ?? p?.yahooStatus ?? "").toUpperCase();
          return {
            playerId: r.playerId,
            name: p?.name ?? "?",
            positions: p?.positions ?? [],
            categoryZ: p?.categoryZ ?? {},
            gamesRemaining: p?.gamesRemainingSeason ?? 0,
            tradeable: !INJURED_SLOTS.includes(r.slot as Slot) && !OUT.has(status) && (p?.playProbability ?? 1) > 0,
          };
        }),
    }));
    const me = teams.find((t) => t.teamId === ctx.myTeam!.id)!;
    trades = findTrades({
      me,
      others: teams.filter((t) => t.teamId !== me.teamId && t.players.length > 0),
      categories: ctx.rules.categories.filter((c) => !ctx.settings.puntCategories.includes(c)),
      rosterSlots: ctx.rules.roster_slots,
      replacement: bestFreeAgent(ctx),
    });
  }

  return {
    date: today,
    lineup: { changes, firstTip: lineup.firstTip, days },
    freeAgents: { swaps: freeAgentSwaps, addsUsed: adds, maxAdds, addsLeft },
    trades,
  };
}

async function addsThisWeek(leagueId: number, teamId: number, week: { start: string; end: string }) {
  const rows = await getDb()
    .select({ type: schema.transactions.type, happenedAt: schema.transactions.happenedAt })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.leagueId, leagueId),
        eq(schema.transactions.teamId, teamId),
        gte(schema.transactions.happenedAt, new Date(`${week.start}T00:00:00Z`)),
      ),
    );
  return rows.filter((r) => {
    const d = toLocalDate(r.happenedAt, "America/New_York");
    return r.type === "add" && d >= week.start && d <= week.end;
  }).length;
}

/** The free agent with the highest per-game value, as a trade replacement. */
function bestFreeAgent(ctx: Awaited<ReturnType<typeof loadLeagueContext>>) {
  const best = ctx.freeAgents
    .map((f) => ctx.players.get(f.playerId))
    .filter((p) => p && p.playProbability > 0)
    .sort((a, b) => b!.valuePerGame - a!.valuePerGame)[0];
  if (!best) return undefined;
  return {
    playerId: best.id,
    name: best.name,
    positions: best.positions,
    categoryZ: best.categoryZ,
    gamesRemaining: best.gamesRemainingSeason,
    tradeable: false,
  };
}
