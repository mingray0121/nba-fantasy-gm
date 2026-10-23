"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "../fetcher";
import { Badge, Empty, ErrorBox, Loading, PageTitle } from "../ui";

interface Week {
  start: string;
  end: string;
  days: string[];
  players: { playerId: number; name: string; team: string | null; valuePerGame: number; games: number; starts: number; days: Record<string, { game: string | null; slot: string | null }> }[];
  startsByDay: Record<string, number>;
  totalStarts: number;
  gamesPlayedLimit: number | null;
  overLimit?: boolean;
}

const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" });

export function WeekView({ leagueId }: { leagueId: number }) {
  const q = useQuery({ queryKey: ["league", leagueId, "week"], queryFn: () => api<Week>(`/api/leagues/${leagueId}/week`) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const w = q.data!;
  if (w.players.length === 0) return <Empty>No roster yet. Press Refresh to pull it from Yahoo.</Empty>;
  return (
    <>
      <PageTitle
        title="Week planner"
        subtitle={
          <>
            {w.start} to {w.end} · {w.totalStarts} projected starts
            {w.gamesPlayedLimit != null && <> of a {w.gamesPlayedLimit}-game limit</>}{" "}
            {w.overLimit && <Badge tone="red">over the limit: bench your weakest starts late in the week</Badge>}
          </>
        }
      />
      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Player</th>
              {w.days.map((d) => (
                <th key={d} className="text-center">
                  {dayLabel(d)}
                </th>
              ))}
              <th className="text-center">Games</th>
              <th className="text-center">Starts</th>
            </tr>
          </thead>
          <tbody>
            {w.players.map((p) => (
              <tr key={p.playerId}>
                <td className="whitespace-nowrap">
                  <Link href={`/players/${p.playerId}?league=${leagueId}`} className="font-medium hover:underline">
                    {p.name}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {p.team} · {p.valuePerGame.toFixed(2)}/g
                  </div>
                </td>
                {w.days.map((d) => {
                  const c = p.days[d];
                  const starting = c?.slot && c.slot !== "BN" && c.slot !== "IL";
                  return (
                    <td key={d} className="text-center text-xs">
                      {c?.game ? (
                        <div className={`rounded px-1 py-0.5 ${starting ? "bg-emerald-100 dark:bg-emerald-950" : "bg-slate-100 dark:bg-slate-800"}`}>
                          <div>{c.game}</div>
                          <div className="font-mono text-[10px] text-slate-500">{c.slot}</div>
                        </div>
                      ) : (
                        <span className="text-slate-300">·</span>
                      )}
                    </td>
                  );
                })}
                <td className="text-center tabular-nums">{p.games}</td>
                <td className="text-center tabular-nums">{p.starts}</td>
              </tr>
            ))}
            <tr className="font-medium">
              <td>Starts per day</td>
              {w.days.map((d) => (
                <td key={d} className="text-center tabular-nums">
                  {w.startsByDay[d]}
                </td>
              ))}
              <td />
              <td className="text-center tabular-nums">{w.totalStarts}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">Green cells are projected starts. Days with more games than slots are where a streamer helps least.</p>
    </>
  );
}
