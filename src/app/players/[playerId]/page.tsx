import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUserPage } from "@/lib/session";
import { playerView } from "@/lib/data/views";
import { Badge, PageTitle, StatusBadge } from "@/components/ui";

const COLS = [
  ["minutes", "MIN"],
  ["pts", "PTS"],
  ["reb", "REB"],
  ["ast", "AST"],
  ["stl", "STL"],
  ["blk", "BLK"],
  ["fg3m", "3PM"],
  ["tov", "TO"],
  ["fgm", "FGM"],
  ["fga", "FGA"],
  ["ftm", "FTM"],
  ["fta", "FTA"],
] as const;

const GAME_COLS = ["MIN", "PTS", "REB", "AST", "ST", "BLK", "TO", "FGM/A", "FTM/A", "3PM/A", "A/T"];

/** ".455", or "-" with no attempts. */
const pct = (made: number, att: number) => (att > 0 ? (made / att).toFixed(3).replace(/^0/, "") : "-");

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ playerId: string }>;
  searchParams: Promise<{ league?: string }>;
}) {
  const userId = await requireUserPage();
  const { playerId } = await params;
  const { league } = await searchParams;
  let leagueId: number | undefined;
  if (league) {
    const [row] = await getDb()
      .select({ id: schema.leagues.id })
      .from(schema.leagues)
      .where(and(eq(schema.leagues.id, Number(league)), eq(schema.leagues.userId, userId)));
    leagueId = row?.id;
  }
  const v = await playerView(Number(playerId), leagueId);
  if (!v) notFound();
  const trendRows = [
    ["Season", v.trends.season],
    ["Last 30 days", v.trends.last30],
    ["Last 14 days", v.trends.last14],
    ["Last 7 days", v.trends.last7],
    ["Projection (per game)", v.trends.projection],
  ] as const;

  return (
    <main className="mx-auto max-w-5xl px-4 py-5">
      <Link href={leagueId ? `/leagues/${leagueId}/today` : "/leagues"} className="text-sm text-court-600">
        ‹ Back
      </Link>
      <PageTitle
        title={v.player.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            {v.player.team ?? "No team"} · {v.player.positions.join(", ") || "positions unknown"}
            <StatusBadge status={v.injury?.status ?? v.player.yahooStatus} />
          </span>
        }
      />
      {v.league && (
        <div className="card mb-4 p-4 text-sm">
          <div>
            Value in this league: <strong>{v.league.valuePerGame.toFixed(2)}</strong> per game
          </div>
          {Object.keys(v.league.categoryZ).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {Object.entries(v.league.categoryZ).map(([k, z]) => (
                <Badge key={k} tone={z > 0.5 ? "green" : z < -0.5 ? "red" : "gray"}>
                  {k} {z > 0 ? "+" : ""}
                  {z.toFixed(2)}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      <section className="card mb-4 overflow-x-auto">
        <h2 className="px-3 pt-3 font-semibold">Averages and trend</h2>
        <table className="table-base">
          <thead>
            <tr>
              <th>Window</th>
              <th className="text-right">GP</th>
              {COLS.map(([, l]) => (
                <th key={l} className="text-right">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trendRows.map(([label, t]) => (
              <tr key={label}>
                <td className="whitespace-nowrap">{label}</td>
                <td className="text-right tabular-nums">{"games" in t ? t.games : ""}</td>
                {COLS.map(([k]) => (
                  <td key={k} className="text-right tabular-nums">
                    {(t as Record<string, number>)[k]?.toFixed(1)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-4">
        <section className="card p-4 text-sm">
          <h2 className="mb-2 font-semibold">Next 7 days</h2>
          {v.schedule.length === 0 && <p className="text-slate-500">No games.</p>}
          <ul className="grid gap-1">
            {v.schedule.map((g) => (
              <li key={g.date}>
                {new Date(`${g.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })} ·{" "}
                {g.home ? "vs" : "@"} {g.opponent}
              </li>
            ))}
          </ul>
          {v.injury && (
            <p className="mt-3 text-xs text-slate-500">
              Injury: {v.injury.status}
              {v.injury.note ? `, ${v.injury.note}` : ""} (updated {new Date(v.injury.updatedAt).toLocaleString()})
            </p>
          )}
        </section>
        <section className="card order-first overflow-x-auto">
          <h2 className="px-3 pt-3 font-semibold">Previous games</h2>
          <table className="table-base">
            <thead>
              <tr>
                <th>Date</th>
                <th>Opp</th>
                {GAME_COLS.map((l) => (
                  <th key={l} className="text-right">
                    {l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {v.gameLog.length === 0 && (
                <tr>
                  <td colSpan={GAME_COLS.length + 2} className="text-slate-500">
                    No games yet this season.
                  </td>
                </tr>
              )}
              {v.gameLog.map((g) => (
                <tr key={g.id}>
                  <td className="whitespace-nowrap">{g.gameDate.slice(5)}</td>
                  <td className="whitespace-nowrap text-slate-500">{g.opponent ?? "—"}</td>
                  {g.dnpReason || g.minutes === 0 ? (
                    <td colSpan={GAME_COLS.length} className="text-slate-500">
                      Did not play{g.dnpReason ? `: ${g.dnpReason}` : ""}
                    </td>
                  ) : (
                    <>
                      <td className="text-right tabular-nums">{Math.round(g.minutes)}</td>
                      <td className="text-right font-medium tabular-nums">{g.pts}</td>
                      <td className="text-right tabular-nums">{g.reb}</td>
                      <td className="text-right tabular-nums">{g.ast}</td>
                      <td className="text-right tabular-nums">{g.stl}</td>
                      <td className="text-right tabular-nums">{g.blk}</td>
                      <td className="text-right tabular-nums">{g.tov}</td>
                      <td className="text-right tabular-nums whitespace-nowrap">
                        {g.fgm}/{g.fga} <span className="text-slate-400">{pct(g.fgm, g.fga)}</span>
                      </td>
                      <td className="text-right tabular-nums whitespace-nowrap">
                        {g.ftm}/{g.fta} <span className="text-slate-400">{pct(g.ftm, g.fta)}</span>
                      </td>
                      <td className="text-right tabular-nums whitespace-nowrap">
                        {g.fg3m}/{g.fg3a} <span className="text-slate-400">{pct(g.fg3m, g.fg3a)}</span>
                      </td>
                      <td className="text-right tabular-nums">{g.tov > 0 ? (g.ast / g.tov).toFixed(2) : g.ast > 0 ? "INF" : "-"}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
