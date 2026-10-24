"use client";

import { useState } from "react";

export interface GameRow {
  id: number;
  gameDate: string;
  opponent: string | null;
  minutes: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  fg3m: number;
  fg3a: number;
  dnpReason: string | null;
}

type Col = { label: string; value: (g: GameRow) => number | null; cell: (g: GameRow) => string; decimals: number };

const pct = (m: number, a: number) => (a > 0 ? m / a : null);
const fmtPct = (v: number | null) => (v == null ? "-" : v.toFixed(3).replace(/^0/, ""));

const COLS: Col[] = [
  { label: "MIN", value: (g) => g.minutes, cell: (g) => String(Math.round(g.minutes)), decimals: 1 },
  { label: "PTS", value: (g) => g.pts, cell: (g) => String(g.pts), decimals: 1 },
  { label: "REB", value: (g) => g.reb, cell: (g) => String(g.reb), decimals: 1 },
  { label: "AST", value: (g) => g.ast, cell: (g) => String(g.ast), decimals: 1 },
  { label: "ST", value: (g) => g.stl, cell: (g) => String(g.stl), decimals: 1 },
  { label: "BLK", value: (g) => g.blk, cell: (g) => String(g.blk), decimals: 1 },
  { label: "TO", value: (g) => g.tov, cell: (g) => String(g.tov), decimals: 1 },
  { label: "3PM", value: (g) => g.fg3m, cell: (g) => String(g.fg3m), decimals: 1 },
  { label: "FG%", value: (g) => pct(g.fgm, g.fga), cell: (g) => `${g.fgm}/${g.fga} ${fmtPct(pct(g.fgm, g.fga))}`, decimals: 3 },
  { label: "FT%", value: (g) => pct(g.ftm, g.fta), cell: (g) => `${g.ftm}/${g.fta} ${fmtPct(pct(g.ftm, g.fta))}`, decimals: 3 },
  { label: "3P%", value: (g) => pct(g.fg3m, g.fg3a), cell: (g) => `${g.fg3m}/${g.fg3a} ${fmtPct(pct(g.fg3m, g.fg3a))}`, decimals: 3 },
  {
    label: "A/T",
    value: (g) => (g.tov > 0 ? g.ast / g.tov : null),
    cell: (g) => (g.tov > 0 ? (g.ast / g.tov).toFixed(2) : g.ast > 0 ? "INF" : "-"),
    decimals: 2,
  },
];

const played = (g: GameRow) => !g.dnpReason && g.minutes > 0;

/** Average of a column over played games (percentages from summed makes and attempts). */
function columnAverage(col: Col, games: GameRow[]): string {
  const g = games.filter(played);
  if (g.length === 0) return "-";
  const sum = (f: (x: GameRow) => number) => g.reduce((s, x) => s + f(x), 0);
  if (col.label === "FG%")
    return fmtPct(
      pct(
        sum((x) => x.fgm),
        sum((x) => x.fga),
      ),
    );
  if (col.label === "FT%")
    return fmtPct(
      pct(
        sum((x) => x.ftm),
        sum((x) => x.fta),
      ),
    );
  if (col.label === "3P%")
    return fmtPct(
      pct(
        sum((x) => x.fg3m),
        sum((x) => x.fg3a),
      ),
    );
  if (col.label === "A/T") {
    const t = sum((x) => x.tov);
    return t > 0 ? (sum((x) => x.ast) / t).toFixed(2) : "-";
  }
  return (sum((x) => col.value(x) ?? 0) / g.length).toFixed(1);
}

/** Per-game line chart of one stat (oldest to newest) with a dashed average line. */
function TrendChart({ col, games }: { col: Col; games: GameRow[] }) {
  const pts = [...games]
    .filter(played)
    .reverse()
    .map((g) => ({ date: g.gameDate.slice(5), v: col.value(g) }))
    .filter((p): p is { date: string; v: number } => p.v != null);
  if (pts.length === 0) return <p className="p-3 text-xs text-slate-500">No games yet.</p>;
  const W = 280;
  const H = 120;
  const pad = 22;
  const avg = pts.reduce((s, p) => s + p.v, 0) / pts.length;
  const hi = Math.max(...pts.map((p) => p.v));
  const lo = Math.min(0, ...pts.map((p) => p.v));
  const span = hi - lo || 1;
  const x = (i: number) => pad + (pts.length === 1 ? (W - 2 * pad) / 2 : (i * (W - 2 * pad)) / (pts.length - 1));
  const y = (v: number) => H - pad - ((v - lo) / span) * (H - 2 * pad);
  const fmt = (v: number) => (col.decimals === 3 ? fmtPct(v) : v.toFixed(col.decimals === 1 ? 0 : 2));
  return (
    <svg width={W} height={H} role="img" aria-label={`${col.label} per game`}>
      <line x1={pad} x2={W - pad} y1={y(avg)} y2={y(avg)} className="stroke-slate-300" strokeDasharray="4 3" />
      <text x={W - pad} y={y(avg) - 4} textAnchor="end" className="fill-slate-400 text-[9px]">
        avg {fmt(avg)}
      </text>
      <polyline points={pts.map((p, i) => `${x(i)},${y(p.v)}`).join(" ")} fill="none" className="stroke-court-600" strokeWidth={2} />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.v)} r={3} className="fill-ember-500" />
          <text x={x(i)} y={y(p.v) - 6} textAnchor="middle" className="fill-slate-600 text-[9px]">
            {fmt(p.v)}
          </text>
          {(pts.length <= 8 || i % Math.ceil(pts.length / 8) === 0) && (
            <text x={x(i)} y={H - 6} textAnchor="middle" className="fill-slate-400 text-[9px]">
              {p.date}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/** A game log; hover (or tap) a stat heading to see that stat game by game. Optional average row. */
export function GameLogTable({ games, showAverage = false, chart = false }: { games: GameRow[]; showAverage?: boolean; chart?: boolean }) {
  const [open, setOpen] = useState<{ label: string; x: number; y: number } | null>(null);
  const openCol = COLS.find((c) => c.label === open?.label);
  const show = (label: string, e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Fixed position next to the heading, kept inside the window.
    setOpen({ label, x: Math.max(8, Math.min(r.left - 120, window.innerWidth - 310)), y: r.bottom + 6 });
  };
  return (
    <div className="overflow-x-auto">
      {chart && openCol && open && (
        <div className="card pointer-events-none fixed z-30 p-2 shadow-lg" style={{ left: open.x, top: open.y }}>
          <div className="px-1 text-xs font-medium">{openCol.label} by game</div>
          <TrendChart col={openCol} games={games} />
        </div>
      )}
      <table className="table-base">
        <thead>
          <tr>
            <th>Date</th>
            <th>Opp</th>
            {COLS.map((c) => (
              <th
                key={c.label}
                className={`text-right ${chart ? "cursor-help underline decoration-dotted underline-offset-4" : ""}`}
                onMouseEnter={(e) => chart && show(c.label, e)}
                onMouseLeave={() => chart && setOpen(null)}
                onClick={(e) => chart && (open?.label === c.label ? setOpen(null) : show(c.label, e))}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {games.length === 0 && (
            <tr>
              <td colSpan={COLS.length + 2} className="text-slate-500">
                No games yet this season.
              </td>
            </tr>
          )}
          {games.map((g) => (
            <tr key={g.id}>
              <td className="whitespace-nowrap">{g.gameDate.slice(5)}</td>
              <td className="whitespace-nowrap text-slate-500">{g.opponent ?? "—"}</td>
              {played(g) ? (
                COLS.map((c) => (
                  <td key={c.label} className="text-right whitespace-nowrap tabular-nums">
                    {c.cell(g)}
                  </td>
                ))
              ) : (
                <td colSpan={COLS.length} className="text-slate-500">
                  Did not play{g.dnpReason ? `: ${g.dnpReason}` : ""}
                </td>
              )}
            </tr>
          ))}
          {showAverage && games.some(played) && (
            <tr className="bg-slate-50 font-medium dark:bg-slate-800/50">
              <td colSpan={2}>Average</td>
              {COLS.map((c) => (
                <td key={c.label} className="text-right tabular-nums">
                  {columnAverage(c, games)}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
