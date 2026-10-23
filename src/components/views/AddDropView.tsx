"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "../fetcher";
import { Badge, Empty, ErrorBox, Loading, PageTitle } from "../ui";

interface P {
  playerId: number;
  name: string;
  valuePerGame: number;
  gamesThisWeek: number;
  playProbability: number;
  onInjuredList?: boolean;
  percentOwned?: number | null;
  faStatus?: string;
}
interface AddDrop {
  suggestions: { add: P; drop: P; perGameGain: number; restOfWeekGain: number; reason: string }[];
  roster: P[];
  freeAgents: P[];
  dropMargin: number;
}

export function AddDropView({ leagueId }: { leagueId: number }) {
  const q = useQuery({ queryKey: ["league", leagueId, "add-drop"], queryFn: () => api<AddDrop>(`/api/leagues/${leagueId}/add-drop`) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const link = (p: P) => (
    <Link href={`/players/${p.playerId}?league=${leagueId}`} className="font-medium hover:underline">
      {p.name}
    </Link>
  );
  return (
    <>
      <PageTitle title="Add / drop" subtitle={`A swap is suggested only when the pickup beats your player by at least ${d.dropMargin} per game (change it in Settings).`} />
      {d.suggestions.length === 0 ? (
        <Empty>No free agent clears your drop margin right now.</Empty>
      ) : (
        <div className="grid gap-2">
          {d.suggestions.map((s) => (
            <div key={s.add.playerId} className="card p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="green">Add</Badge> {link(s.add)} <Badge tone="red">Drop</Badge> {link(s.drop)}
                <span className="ml-auto tabular-nums">
                  +{s.perGameGain}/game · {s.restOfWeekGain >= 0 ? "+" : ""}
                  {s.restOfWeekGain} this week
                </span>
              </div>
              <p className="mt-1 text-slate-500">{s.reason}</p>
            </div>
          ))}
        </div>
      )}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <section className="card overflow-x-auto">
          <h2 className="px-3 pt-3 font-semibold">Your weakest players</h2>
          <table className="table-base">
            <thead>
              <tr>
                <th>Player</th>
                <th className="text-right">Per game</th>
                <th className="text-right">Games left</th>
              </tr>
            </thead>
            <tbody>
              {d.roster.slice(0, 8).map((p) => (
                <tr key={p.playerId}>
                  <td>
                    {link(p)} {p.onInjuredList && <Badge tone="red">IL</Badge>}
                  </td>
                  <td className="text-right tabular-nums">{p.valuePerGame.toFixed(2)}</td>
                  <td className="text-right tabular-nums">{p.gamesThisWeek}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card overflow-x-auto">
          <h2 className="px-3 pt-3 font-semibold">Best available</h2>
          <table className="table-base">
            <thead>
              <tr>
                <th>Player</th>
                <th className="text-right">Per game</th>
                <th className="text-right">Games left</th>
                <th className="text-right">Owned</th>
              </tr>
            </thead>
            <tbody>
              {d.freeAgents.slice(0, 15).map((p) => (
                <tr key={p.playerId}>
                  <td>
                    {link(p)} {p.faStatus === "W" && <Badge tone="amber">waivers</Badge>}
                    {p.playProbability === 0 && <Badge tone="red">out</Badge>}
                  </td>
                  <td className="text-right tabular-nums">{p.valuePerGame.toFixed(2)}</td>
                  <td className="text-right tabular-nums">{p.gamesThisWeek}</td>
                  <td className="text-right tabular-nums">{p.percentOwned != null ? `${p.percentOwned}%` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
