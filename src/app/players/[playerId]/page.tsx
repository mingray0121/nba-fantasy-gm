import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUserPage } from "@/lib/session";
import { playerView } from "@/lib/data/views";
import { Badge, PageTitle, StatusBadge } from "@/components/ui";
import { GameLogTable } from "@/components/GameLogTable";

type Avg = {
  gp: number;
  min: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  fg3m: number;
  fgPct: number | null;
  ftPct: number | null;
  fg3Pct: number | null;
};

const fmtPct = (v: number | null) => (v == null ? "-" : v.toFixed(3).replace(/^0/, ""));
const AVG_COLS: [string, (a: Avg) => string][] = [
  ["GP", (a) => (a.gp ? String(a.gp) : "")],
  ["MIN", (a) => a.min.toFixed(1)],
  ["PTS", (a) => a.pts.toFixed(1)],
  ["REB", (a) => a.reb.toFixed(1)],
  ["AST", (a) => a.ast.toFixed(1)],
  ["ST", (a) => a.stl.toFixed(1)],
  ["BLK", (a) => a.blk.toFixed(1)],
  ["TO", (a) => a.tov.toFixed(1)],
  ["3PM", (a) => a.fg3m.toFixed(1)],
  ["FG%", (a) => fmtPct(a.fgPct)],
  ["FT%", (a) => fmtPct(a.ftPct)],
  ["3P%", (a) => fmtPct(a.fg3Pct)],
  ["A/T", (a) => (a.tov > 0 ? (a.ast / a.tov).toFixed(2) : "-")],
];

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
  const avgRows: { label: string; row: Avg; muted?: boolean }[] = [
    ...v.averages.map((a) => ({ label: a.label, row: a })),
    { label: "Projection (per game)", row: v.projection },
    ...v.pastSeasons.map((a) => ({ label: a.label, row: a, muted: true })),
    ...(v.career ? [{ label: "Career", row: v.career, muted: true }] : []),
  ];
  const played = v.gameLog.filter((g) => !g.dnpReason && g.minutes > 0);

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
        <h2 className="px-3 pt-3 font-semibold">Averages</h2>
        <p className="px-3 text-xs text-slate-500">Per game, counted by games played. Past seasons and career from ESPN.</p>
        <table className="table-base">
          <thead>
            <tr>
              <th />
              {AVG_COLS.map(([l]) => (
                <th key={l} className="text-right">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {avgRows.map(({ label, row, muted }) => (
              <tr key={label} className={muted ? "text-slate-500" : label.startsWith("Projection") ? "font-medium" : ""}>
                <td className="whitespace-nowrap">{label}</td>
                {AVG_COLS.map(([l, f]) => (
                  <td key={l} className="text-right tabular-nums">
                    {f(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card mb-4">
        <h2 className="px-3 pt-3 font-semibold">Previous 5 games</h2>
        <GameLogTable games={played.slice(0, 5)} showAverage />
      </section>

      <div className="grid gap-4">
        <section className="card p-4 text-sm">
          <h2 className="mb-2 font-semibold">Next 7 days</h2>
          {v.schedule.length === 0 && <p className="text-slate-500">No games.</p>}
          <ul className="grid gap-1">
            {v.schedule.map((g) => (
              <li key={g.date}>
                {new Date(`${g.date}T12:00:00Z`).toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                })}{" "}
                · {g.home ? "vs" : "@"} {g.opponent}
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
        <section className="card order-first">
          <h2 className="px-3 pt-3 font-semibold">Current season</h2>
          <p className="px-3 text-xs text-slate-500">Hover a stat heading (or tap it) to see it game by game.</p>
          <GameLogTable games={v.gameLog} chart />
        </section>
      </div>
    </main>
  );
}
