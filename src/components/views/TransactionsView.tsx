"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../fetcher";
import { ErrorBox, Loading, PageTitle } from "../ui";
import { useTimeZone } from "../timezone";
import { LockedNotice } from "./RosterView";

interface Data {
  week: { start: string; end: string };
  maxAdds: number | null;
  teams: { id: number; name: string; isMine: boolean; addsThisWeek: number }[];
  history: { id: number; type: "add" | "drop" | "trade"; happenedAt: string; player: string; team: string | null }[];
}

interface RosterPlayer {
  playerId: number;
  name: string;
  slot: string;
}

interface SearchResult {
  id: number;
  name: string;
  positions: string[];
  team: string | null;
  injury: string | null;
  owner: { teamId: number; teamName: string } | null;
}

/** Manual leagues: record adds and drops, and track the weekly add limit. */
export function TransactionsView({ leagueId }: { leagueId: number }) {
  const qc = useQueryClient();
  const [tz] = useTimeZone();
  const data = useQuery({
    queryKey: ["league", leagueId, "transactions"],
    queryFn: () => api<Data>(`/api/leagues/${leagueId}/transactions`),
  });
  const [selected, setSelected] = useState<number | null>(null);
  const teamId = selected ?? data.data?.teams.find((t) => t.isMine)?.id ?? data.data?.teams[0]?.id ?? null;
  const team = data.data?.teams.find((t) => t.id === teamId) ?? null;

  const roster = useQuery({
    queryKey: ["league", leagueId, "roster", teamId],
    queryFn: () => api<{ players: RosterPlayer[] }>(`/api/leagues/${leagueId}/roster?teamId=${teamId}`),
    enabled: teamId != null,
  });
  const [drop, setDrop] = useState<number | "">("");
  const [add, setAdd] = useState<SearchResult | null>(null);
  const [search, setSearch] = useState("");
  const results = useQuery({
    queryKey: ["player-search", leagueId, search],
    queryFn: () => api<{ players: SearchResult[] }>(`/api/players/search?league=${leagueId}&q=${encodeURIComponent(search)}`),
    enabled: search.trim().length >= 2,
  });
  const move = useMutation({
    mutationFn: () =>
      api<{ locked: string[] }>(`/api/leagues/${leagueId}/transactions`, {
        method: "POST",
        body: JSON.stringify({ teamId, addPlayerId: add?.id, dropPlayerId: drop === "" ? undefined : drop }),
      }),
    onSuccess: () => {
      setAdd(null);
      setDrop("");
      qc.invalidateQueries({ queryKey: ["league", leagueId] });
    },
  });

  if (data.isLoading) return <Loading />;
  if (data.error) return <ErrorBox error={data.error} />;
  const d = data.data!;
  const fmtWhen = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz });

  return (
    <>
      <PageTitle
        title="Transactions"
        subtitle={`Week of ${d.week.start} to ${d.week.end}. Record each add and drop you make in Yahoo so the roster here stays in sync.`}
      />
      <div className="card mb-4 flex flex-wrap items-center gap-2 p-4">
        {d.teams.map((t) => (
          <button key={t.id} className={t.id === teamId ? "btn-primary" : "btn-secondary"} onClick={() => setSelected(t.id)}>
            {t.name}
            {t.isMine ? " (you)" : ""}
            <span className="ml-1 text-xs opacity-75">
              {t.addsThisWeek}
              {d.maxAdds != null ? ` / ${d.maxAdds}` : ""}
            </span>
          </button>
        ))}
      </div>

      {team && (
        <div className="card mb-4 grid gap-4 p-4 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-medium text-slate-500 uppercase">Add</div>
            {add ? (
              <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700">
                <span>
                  {add.name} <span className="text-xs text-slate-500">{[add.team, add.positions.join(", ")].filter(Boolean).join(" · ")}</span>
                </span>
                <button className="text-xs text-slate-500 underline" onClick={() => setAdd(null)}>
                  Change
                </button>
              </div>
            ) : (
              <>
                <input className="input" placeholder="Search free agents by name" value={search} onChange={(e) => setSearch(e.target.value)} />
                <div className="mt-2 grid gap-1">
                  {results.data?.players.map((p) => (
                    <button
                      key={p.id}
                      className="btn-secondary justify-between"
                      disabled={Boolean(p.owner)}
                      onClick={() => {
                        setAdd(p);
                        setSearch("");
                      }}
                    >
                      <span>
                        {p.name}
                        <span className="ml-2 text-xs text-slate-500">{[p.team, p.positions.join(", ")].filter(Boolean).join(" · ")}</span>
                        {p.injury && <span className="ml-2 text-xs text-red-600">{p.injury}</span>}
                      </span>
                      <span className="text-xs text-slate-500">{p.owner ? `On ${p.owner.teamName}` : "Free agent"}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-500 uppercase">Drop</div>
            <select className="input" value={drop} onChange={(e) => setDrop(e.target.value === "" ? "" : Number(e.target.value))}>
              <option value="">Nobody</option>
              {roster.data?.players.map((p) => (
                <option key={p.playerId} value={p.playerId}>
                  {p.name} ({p.slot})
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-slate-500">The added player takes the dropped player&apos;s slot, otherwise the bench.</p>
          </div>
          <div className="md:col-span-2">
            {move.error && <ErrorBox error={move.error} />}
            {move.data?.locked.length ? <LockedNotice notes={move.data.locked} /> : null}
            <button className="btn-primary" disabled={move.isPending || (!add && drop === "")} onClick={() => move.mutate()}>
              {move.isPending ? "Saving…" : `Save move for ${team.name}`}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>When</th>
              <th>Team</th>
              <th>Move</th>
              <th>Player</th>
            </tr>
          </thead>
          <tbody>
            {d.history.map((h) => (
              <tr key={h.id}>
                <td className="text-xs whitespace-nowrap">{fmtWhen(h.happenedAt)}</td>
                <td>{h.team ?? "—"}</td>
                <td className={h.type === "add" ? "text-green-700 dark:text-green-400" : "text-red-600"}>{h.type === "add" ? "Added" : "Dropped"}</td>
                <td>{h.player}</td>
              </tr>
            ))}
            {d.history.length === 0 && (
              <tr>
                <td colSpan={4} className="text-slate-500">
                  No moves yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
