"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../fetcher";
import { fmtTipTime, useTimeZone } from "../timezone";
import { Badge, Empty, ErrorBox, Loading, PageTitle, StatusBadge } from "../ui";
import type { LineupRow } from "@/lib/data/views";

interface Lineup {
  date: string;
  rows: LineupRow[];
  firstTip: string | null;
  rosterDate: string | null;
  totalValue?: number;
}

/** Yahoo's roster order, split the way Yahoo shows it. */
const SECTIONS = [
  { title: "Starters", slots: ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL"] },
  { title: "Bench", slots: ["BN"] },
  { title: "Injured list", slots: ["IL", "IL+"] },
];

function localToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function shift(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function TodayView({ leagueId }: { leagueId: number }) {
  const [date, setDate] = useState(localToday);
  const [tz] = useTimeZone();
  const q = useQuery({
    queryKey: ["league", leagueId, "lineup", date],
    queryFn: () => api<Lineup>(`/api/leagues/${leagueId}/lineup?date=${date}`),
  });
  const changes = q.data?.rows.filter((r) => r.action !== "keep") ?? [];

  return (
    <>
      <PageTitle
        title={date === localToday() ? "Today" : date}
        subtitle={
          q.data?.firstTip ? `First tip-off ${fmtTipTime(q.data.firstTip, tz)} · each player locks at their own tip` : "No games scheduled"
        }
        actions={
          <div className="flex items-center gap-1">
            <button className="btn-secondary px-2" onClick={() => setDate((d) => shift(d, -1))} aria-label="Previous day">
              ‹
            </button>
            <input type="date" className="input w-auto py-1.5" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <button className="btn-secondary px-2" onClick={() => setDate((d) => shift(d, 1))} aria-label="Next day">
              ›
            </button>
          </div>
        }
      />
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && q.data.rows.length === 0 && <Empty>No roster yet. Press Refresh to pull it from Yahoo.</Empty>}
      {q.data && q.data.rows.length > 0 && (
        <>
          <div className="card mb-4 p-4 text-sm">
            {changes.length === 0 ? (
              <p>Your current lineup is already the best one for this day.</p>
            ) : (
              <>
                <p className="font-medium">
                  {changes.length} change{changes.length > 1 ? "s" : ""} to make in Yahoo:
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {changes.map((r) => (
                    <li key={r.playerId}>
                      {r.action === "start" ? "Start" : "Bench"} <strong>{r.name}</strong>
                      {r.action === "start" ? ` at ${r.recommendedSlot}` : ""} (now {r.currentSlot})
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          {SECTIONS.map((section) => {
            const rows = q.data!.rows.filter((r) => section.slots.includes(r.recommendedSlot));
            if (rows.length === 0) return null;
            return (
              <div key={section.title} className="card mb-4 overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{section.title}</th>
                      <th>Player</th>
                      <th>Game</th>
                      <th className="text-right">Value</th>
                      <th className="hidden md:table-cell">Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.playerId}>
                        <td className="font-mono text-xs">
                          {r.recommendedSlot}
                          {r.action !== "keep" && (
                            <div className="mt-0.5">
                              <Badge tone={r.action === "start" ? "green" : "amber"}>{r.action === "start" ? "start" : "bench"}</Badge>
                            </div>
                          )}
                        </td>
                        <td>
                          <Link href={`/players/${r.playerId}?league=${leagueId}`} className="font-medium hover:underline">
                            {r.name}
                          </Link>{" "}
                          <StatusBadge status={r.status} />
                          <div className="text-xs text-slate-500">
                            {r.team ?? "FA"} · {r.positions.join(", ")}
                          </div>
                          <div className="text-xs text-slate-500 md:hidden">{r.reason}</div>
                        </td>
                        <td className="text-xs">
                          {r.game ? (
                            <>
                              {r.game.home ? "vs" : "@"} {r.game.opponent}
                              <div className="text-slate-500">{fmtTipTime(r.game.tipTime, tz)}</div>
                            </>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="text-right tabular-nums">{r.value.toFixed(2)}</td>
                        <td className="hidden text-xs text-slate-500 md:table-cell">{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}
