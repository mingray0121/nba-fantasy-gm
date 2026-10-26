"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../fetcher";
import { fits } from "./RosterView";
import { fmtTipTime, useTimeZone } from "../timezone";
import { Badge, Empty, ErrorBox, Loading, PlayerLink, StatusBadge, YouBadge } from "../ui";

interface Avg {
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
}

interface Player {
  id: number;
  name: string;
  positions: string[];
  team: string | null;
  injury: string | null;
  game: string | null;
  mine: boolean;
  owner: string | null;
  value: number | null;
  categoryZ: Record<string, number>;
  gamesLeftThisWeek: number;
  season: Avg;
  last5: Avg;
}

interface Data {
  date: string;
  today: string;
  strip: string[];
  games: { home: string; away: string; tipTime: string | null }[];
  categories: string[];
  rosterSlots: Record<string, number>;
  players: Player[];
}

const SLOTS = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL"];
const pct = (v: number | null) => (v == null ? "-" : v.toFixed(3).replace(/^0/, ""));

const dayName = (d: string, today: string) => {
  const diff = Math.round((Date.parse(d) - Date.parse(today)) / 86400000);
  if (diff === 0) return "Tonight";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Last night";
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
};
const monthDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "UTC" });

/**
 * A night of games, picked from a date strip (US Eastern game nights, like the NBA app's
 * schedule): open a team, pick a slot to see who could fill it, and compare players.
 */
export function UpcomingPanel({ leagueId }: { leagueId: number }) {
  const [tz] = useTimeZone();
  const [picked, setPicked] = useState<string | null>(null); // null: let the server pick the next open slate
  const q = useQuery({
    queryKey: ["league", leagueId, "upcoming", picked],
    queryFn: () => api<Data>(`/api/leagues/${leagueId}/upcoming${picked ? `?date=${picked}` : ""}`),
    placeholderData: (prev) => prev,
  });
  const [team, setTeam] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [compare, setCompare] = useState<number[]>([]);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const toggle = (id: number) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id].slice(-4)));
  const candidates = slot ? d.players.filter((p) => fits(slot, p.positions) && (p.game || p.mine)) : [];
  const now = Date.now();

  return (
    <>
      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
        {d.strip.map((day) => (
          <button
            key={day}
            onClick={() => {
              setPicked(day);
              setTeam(null);
            }}
            className={`min-w-[4.5rem] shrink-0 rounded-lg px-3 py-1.5 text-center text-xs ${
              day === d.date ? "bg-court-600 text-white" : "bg-white ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:ring-slate-700"
            }`}
          >
            <div className="font-semibold">{dayName(day, d.today)}</div>
            <div className={day === d.date ? "text-white/80" : "text-slate-500"}>{monthDay(day)}</div>
          </button>
        ))}
      </div>
      {d.games.length === 0 ? (
        <Empty>No NBA games on {d.date}.</Empty>
      ) : (
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {d.games.map((g) => (
            <div key={`${g.away}@${g.home}`} className="card flex items-center justify-between gap-2 p-3 text-sm">
              {[g.away, g.home].map((t, i) => (
                <button
                  key={t}
                  className={`rounded-md px-2 py-1 font-semibold ${team === t ? "bg-court-600 text-white" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
                  onClick={() => setTeam(team === t ? null : t)}
                >
                  {i === 1 && <span className="mr-1 font-normal text-slate-400">@</span>}
                  {t}
                </button>
              ))}
              <span className="text-xs text-slate-500">
                {g.tipTime && Date.parse(g.tipTime) <= now ? "Started" : fmtTipTime(g.tipTime, tz)}
              </span>
            </div>
          ))}
        </div>
      )}
      {team && <TeamPanel leagueId={leagueId} abbr={team} />}

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-sm text-slate-500">Pick a slot:</span>
        {SLOTS.map((s) => (
          <button key={s} className={slot === s ? "btn-primary px-2.5 py-1 text-xs" : "btn-secondary px-2.5 py-1 text-xs"} onClick={() => setSlot(slot === s ? null : s)}>
            {s === "UTIL" ? "Util" : s}
          </button>
        ))}
      </div>
      {slot && (
        <div className="card mb-4 overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Compare</th>
                <th>Player</th>
                <th>Game</th>
                <th className="text-right">Value</th>
                <th className="text-right">PTS</th>
                <th className="text-right">REB</th>
                <th className="text-right">AST</th>
                <th className="text-right">Games left</th>
                <th>Owner</th>
              </tr>
            </thead>
            <tbody>
              {candidates.slice(0, 40).map((p) => (
                <tr key={p.id} className={p.mine ? "bg-ember-500/10" : ""}>
                  <td>
                    <input type="checkbox" checked={compare.includes(p.id)} onChange={() => toggle(p.id)} aria-label={`Compare ${p.name}`} />
                  </td>
                  <td className="whitespace-nowrap">
                    <PlayerLink id={p.id} name={p.name} leagueId={leagueId} className="font-medium" /> <StatusBadge status={p.injury} />
                    <div className="text-xs text-slate-500">{[p.team, p.positions.join(", ")].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="text-xs">{p.game ?? <span className="text-slate-400">No game</span>}</td>
                  <td className="text-right font-medium tabular-nums">{p.value == null ? "—" : p.value.toFixed(2)}</td>
                  <td className="text-right tabular-nums">{p.season.pts.toFixed(1)}</td>
                  <td className="text-right tabular-nums">{p.season.reb.toFixed(1)}</td>
                  <td className="text-right tabular-nums">{p.season.ast.toFixed(1)}</td>
                  <td className="text-right tabular-nums">{p.gamesLeftThisWeek}</td>
                  <td>{p.mine ? <YouBadge /> : p.owner ? <span className="text-xs">{p.owner}</span> : <Badge tone="green">Free agent</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Compare players={d.players.filter((p) => compare.includes(p.id))} categories={d.categories} onRemove={toggle} leagueId={leagueId} />
    </>
  );
}

function TeamPanel({ leagueId, abbr }: { leagueId: number; abbr: string }) {
  const q = useQuery({
    queryKey: ["league", leagueId, "nba-team", abbr],
    queryFn: () =>
      api<{
        team: { name: string };
        teamStats: { gp: number; pts: number; reb: number; ast: number; fg3m: number; stl: number; blk: number; tov: number; fgPct: number | null; ftPct: number | null } | null;
        players: { id: number; name: string; positions: string[]; injury: string | null; gp: number; min: number; pts: number; reb: number; ast: number; owner: string | null; mine: boolean }[];
      }>(`/api/leagues/${leagueId}/nba-teams?team=${abbr}`),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { team, teamStats: t, players } = q.data!;
  return (
    <div className="card mb-4 p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h3 className="font-semibold">{team.name}</h3>
        {t && (
          <span className="text-xs text-slate-500">
            Per game ({t.gp} games): {t.pts} PTS · {t.reb} REB · {t.ast} AST · {t.fg3m} 3PM · {t.stl} ST · {t.blk} BLK · {t.tov} TO · FG {pct(t.fgPct)} · FT{" "}
            {pct(t.ftPct)}
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Top 10 by minutes</th>
              <th>Pos</th>
              <th className="text-right">GP</th>
              <th className="text-right">MIN</th>
              <th className="text-right">PTS</th>
              <th className="text-right">REB</th>
              <th className="text-right">AST</th>
              <th>In your league</th>
            </tr>
          </thead>
          <tbody>
            {players.slice(0, 10).map((p) => (
              <tr key={p.id} className={p.mine ? "bg-ember-500/10" : ""}>
                <td className="whitespace-nowrap">
                  <PlayerLink id={p.id} name={p.name} leagueId={leagueId} className="font-medium" /> <StatusBadge status={p.injury} />
                </td>
                <td className="text-xs text-slate-500">{p.positions.join(", ")}</td>
                <td className="text-right tabular-nums">{p.gp}</td>
                <td className="text-right tabular-nums">{p.min.toFixed(1)}</td>
                <td className="text-right tabular-nums">{p.pts.toFixed(1)}</td>
                <td className="text-right tabular-nums">{p.reb.toFixed(1)}</td>
                <td className="text-right tabular-nums">{p.ast.toFixed(1)}</td>
                <td>{p.mine ? <YouBadge /> : p.owner ? <span className="text-xs">{p.owner}</span> : <Badge tone="green">Free agent</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Side-by-side comparison; the best value in each row is highlighted. */
function Compare({ players, categories, onRemove, leagueId }: { players: Player[]; categories: string[]; onRemove: (id: number) => void; leagueId: number }) {
  if (players.length === 0) return null;
  type Row = [string, (p: Player) => number | null, (p: Player) => string, boolean?]; // label, value, display, lower is better
  const f1 = (v: number) => v.toFixed(1);
  const rows: Row[] = [
    ["Value / game", (p) => p.value, (p) => (p.value == null ? "—" : p.value.toFixed(2))],
    ["Games left this week", (p) => p.gamesLeftThisWeek, (p) => String(p.gamesLeftThisWeek)],
    ["Season PTS", (p) => p.season.pts, (p) => f1(p.season.pts)],
    ["Season REB", (p) => p.season.reb, (p) => f1(p.season.reb)],
    ["Season AST", (p) => p.season.ast, (p) => f1(p.season.ast)],
    ["Season ST", (p) => p.season.stl, (p) => f1(p.season.stl)],
    ["Season BLK", (p) => p.season.blk, (p) => f1(p.season.blk)],
    ["Season 3PM", (p) => p.season.fg3m, (p) => f1(p.season.fg3m)],
    ["Season TO", (p) => p.season.tov, (p) => f1(p.season.tov), true],
    ["Season FG%", (p) => p.season.fgPct, (p) => pct(p.season.fgPct)],
    ["Season FT%", (p) => p.season.ftPct, (p) => pct(p.season.ftPct)],
    ["Last 5 PTS", (p) => p.last5.pts, (p) => f1(p.last5.pts)],
    ["Last 5 MIN", (p) => p.last5.min, (p) => f1(p.last5.min)],
    ...categories.map((c): Row => [`${c} z`, (p) => p.categoryZ[c] ?? null, (p) => (p.categoryZ[c] == null ? "—" : p.categoryZ[c].toFixed(2))]),
  ];
  const best = (r: Row) => {
    const vals = players.map((p) => r[1](p)).filter((v): v is number => v != null);
    return vals.length ? (r[3] ? Math.min(...vals) : Math.max(...vals)) : null;
  };
  return (
    <div className="card overflow-x-auto">
      <h3 className="px-3 pt-3 font-semibold">Compare</h3>
      <table className="table-base">
        <thead>
          <tr>
            <th />
            {players.map((p) => (
              <th key={p.id} className="text-right normal-case">
                <PlayerLink id={p.id} name={p.name} leagueId={leagueId} />
                <button className="ml-2 text-slate-400 hover:text-rose-600" onClick={() => onRemove(p.id)} aria-label={`Remove ${p.name}`}>
                  ×
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const b = players.length > 1 ? best(r) : null;
            return (
              <tr key={r[0]}>
                <td className="whitespace-nowrap text-slate-500">{r[0]}</td>
                {players.map((p) => (
                  <td key={p.id} className={`text-right tabular-nums ${b != null && r[1](p) === b ? "font-semibold text-emerald-700 dark:text-emerald-400" : ""}`}>
                    {r[2](p)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
