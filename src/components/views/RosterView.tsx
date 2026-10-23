"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../fetcher";
import { ErrorBox, PageTitle } from "../ui";
import type { LineupRow } from "@/lib/data/views";

const SLOTS = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "BN", "IL", "IL+"];
const POSITIONS = ["PG", "SG", "SF", "PF", "C"];

interface Entry {
  playerId: number;
  name: string;
  slot: string;
  positions: string[];
}

/** Manual leagues only: pick players and their current slots. */
export function RosterView({ leagueId }: { leagueId: number }) {
  const qc = useQueryClient();
  const current = useQuery({
    queryKey: ["league", leagueId, "lineup", "roster-editor"],
    queryFn: () => api<{ rows: LineupRow[] }>(`/api/leagues/${leagueId}/lineup`),
  });
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const list =
    entries ?? current.data?.rows.map((r) => ({ playerId: r.playerId, name: r.name, slot: r.currentSlot, positions: r.positions })) ?? [];
  const [search, setSearch] = useState("");
  const results = useQuery({
    queryKey: ["player-search", search],
    queryFn: () => api<{ players: { id: number; name: string; positions: string[] }[] }>(`/api/players/search?q=${encodeURIComponent(search)}`),
    enabled: search.trim().length >= 2,
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/api/leagues/${leagueId}/roster`, {
        method: "PUT",
        body: JSON.stringify({ players: list.map((e) => ({ playerId: e.playerId, slot: e.slot, positions: e.positions })) }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["league", leagueId] }),
  });
  const update = (i: number, patch: Partial<Entry>) => setEntries(list.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  return (
    <>
      <PageTitle title="Roster" subtitle="For a manual league, set your players and their slots here." />
      <div className="card mb-4 p-4">
        <input className="input" placeholder="Search players by name" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="mt-2 grid gap-1">
          {results.data?.players.map((p) => (
            <button
              key={p.id}
              className="btn-secondary justify-between"
              onClick={() => {
                if (!list.some((e) => e.playerId === p.id)) setEntries([...list, { playerId: p.id, name: p.name, slot: "BN", positions: p.positions }]);
                setSearch("");
              }}
            >
              <span>{p.name}</span>
              <span className="text-xs text-slate-500">{p.positions.join(", ") || "positions unknown"}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Player</th>
              <th>Positions</th>
              <th>Slot</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((e, i) => (
              <tr key={e.playerId}>
                <td>{e.name}</td>
                <td>
                  <div className="flex gap-1">
                    {POSITIONS.map((p) => (
                      <label key={p} className="flex items-center gap-0.5 text-xs">
                        <input
                          type="checkbox"
                          checked={e.positions.includes(p)}
                          onChange={(ev) => update(i, { positions: ev.target.checked ? [...e.positions, p] : e.positions.filter((x) => x !== p) })}
                        />
                        {p}
                      </label>
                    ))}
                  </div>
                </td>
                <td>
                  <select className="input w-auto py-1" value={e.slot} onChange={(ev) => update(i, { slot: ev.target.value })}>
                    {SLOTS.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <button className="text-xs text-red-600" onClick={() => setEntries(list.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {save.error && <ErrorBox error={save.error} />}
      <button className="btn-primary mt-3" disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? "Saving…" : "Save roster"}
      </button>
    </>
  );
}
