"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../fetcher";
import { fmtTipTime, useTimeZone } from "../timezone";
import { ErrorBox, PageTitle, StatusBadge } from "../ui";

/** Yahoo's roster order. */
const SLOTS = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "BN", "IL", "IL+"];
const SECTIONS = [
  { title: "Starters", slots: ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL"] },
  { title: "Bench", slots: ["BN"] },
  { title: "Injured list", slots: ["IL", "IL+"] },
];
const POSITIONS = ["PG", "SG", "SF", "PF", "C"];

interface Team {
  id: number;
  name: string;
  isMine: boolean;
}

interface Entry {
  playerId: number;
  name: string;
  slot: string;
  positions: string[];
  team?: string | null;
  injury?: string | null;
  game?: { opponent: string; home: boolean; tipTime: string | null } | null;
}

interface SearchResult {
  id: number;
  name: string;
  positions: string[];
  team: string | null;
  injury: string | null;
  owner: { teamId: number; teamName: string } | null;
}

/** Manual leagues only: every team's players and their current slots. */
export function RosterView({ leagueId }: { leagueId: number }) {
  const qc = useQueryClient();
  const teams = useQuery({
    queryKey: ["league", leagueId, "teams"],
    queryFn: () => api<{ teams: Team[] }>(`/api/leagues/${leagueId}/teams`),
  });
  const [selected, setSelected] = useState<number | null>(null);
  const teamId = selected ?? teams.data?.teams.find((t) => t.isMine)?.id ?? teams.data?.teams[0]?.id ?? null;
  const team = teams.data?.teams.find((t) => t.id === teamId) ?? null;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["league", leagueId] });
  const addTeam = useMutation({
    mutationFn: (name: string) => api<{ team: Team }>(`/api/leagues/${leagueId}/teams`, { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: (r) => {
      setSelected(r.team.id);
      invalidate();
    },
  });
  const editTeam = useMutation({
    mutationFn: (patch: { name?: string; isMine?: true }) =>
      api(`/api/leagues/${leagueId}/teams/${teamId}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: invalidate,
  });
  const deleteTeam = useMutation({
    mutationFn: () => api(`/api/leagues/${leagueId}/teams/${teamId}`, { method: "DELETE" }),
    onSuccess: () => {
      setSelected(null);
      invalidate();
    },
  });

  return (
    <>
      <PageTitle title="Roster" subtitle="Enter every team's players. Players on no team count as free agents for add / drop." />
      <div className="card mb-4 flex flex-wrap items-center gap-2 p-4">
        {teams.data?.teams.map((t) => (
          <button key={t.id} className={t.id === teamId ? "btn-primary" : "btn-secondary"} onClick={() => setSelected(t.id)}>
            {t.name}
            {t.isMine ? " (you)" : ""}
          </button>
        ))}
        <button
          className="btn-secondary"
          disabled={addTeam.isPending}
          onClick={() => {
            const name = prompt("Team name");
            if (name?.trim()) addTeam.mutate(name.trim());
          }}
        >
          + Add team
        </button>
      </div>
      {(teams.error || addTeam.error || editTeam.error || deleteTeam.error) && (
        <ErrorBox error={teams.error ?? addTeam.error ?? editTeam.error ?? deleteTeam.error} />
      )}
      {team && (
        <>
          <div className="mb-3 flex flex-wrap gap-3 text-xs">
            <button
              className="text-slate-500 underline"
              onClick={() => {
                const name = prompt("Rename team", team.name);
                if (name?.trim()) editTeam.mutate({ name: name.trim() });
              }}
            >
              Rename
            </button>
            {!team.isMine && (
              <>
                <button className="text-slate-500 underline" onClick={() => editTeam.mutate({ isMine: true })}>
                  This is my team
                </button>
                <button
                  className="text-red-600 underline"
                  onClick={() => {
                    if (confirm(`Delete ${team.name} and its roster?`)) deleteTeam.mutate();
                  }}
                >
                  Delete team
                </button>
              </>
            )}
          </div>
          <TeamRoster key={team.id} leagueId={leagueId} team={team} />
        </>
      )}
    </>
  );
}

function TeamRoster({ leagueId, team }: { leagueId: number; team: Team }) {
  const qc = useQueryClient();
  const current = useQuery({
    queryKey: ["league", leagueId, "roster", team.id],
    queryFn: () => api<{ players: Entry[] }>(`/api/leagues/${leagueId}/roster?teamId=${team.id}`),
  });
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [tz] = useTimeZone();
  const list = entries ?? current.data?.players ?? [];
  const [search, setSearch] = useState("");
  const results = useQuery({
    queryKey: ["player-search", leagueId, search],
    queryFn: () => api<{ players: SearchResult[] }>(`/api/players/search?league=${leagueId}&q=${encodeURIComponent(search)}`),
    enabled: search.trim().length >= 2,
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/api/leagues/${leagueId}/roster`, {
        method: "PUT",
        body: JSON.stringify({
          teamId: team.id,
          players: list.map((e) => ({ playerId: e.playerId, slot: e.slot, positions: e.positions })),
        }),
      }),
    onSuccess: () => {
      setEntries(null);
      qc.invalidateQueries({ queryKey: ["league", leagueId] });
    },
  });
  const update = (i: number, patch: Partial<Entry>) => setEntries(list.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  return (
    <>
      <div className="card mb-4 p-4">
        <input
          className="input"
          placeholder={`Add a player to ${team.name}: search by name`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="mt-2 grid gap-1">
          {results.data?.players.map((p) => {
            const onThisTeam = list.some((e) => e.playerId === p.id);
            const elsewhere = p.owner && p.owner.teamId !== team.id ? p.owner.teamName : null;
            return (
              <button
                key={p.id}
                className="btn-secondary justify-between"
                disabled={onThisTeam || Boolean(elsewhere)}
                onClick={() => {
                  setEntries([
                    ...list,
                    { playerId: p.id, name: p.name, slot: "BN", positions: p.positions, team: p.team, injury: p.injury },
                  ]);
                  setSearch("");
                }}
              >
                <span>
                  {p.name}
                  <span className="ml-2 text-xs text-slate-500">
                    {[p.team, p.positions.join(", ") || "positions unknown"].filter(Boolean).join(" · ")}
                  </span>
                  {p.injury && <span className="ml-2 text-xs text-red-600">{p.injury}</span>}
                </span>
                <span className="text-xs text-slate-500">{onThisTeam ? "On this team" : elsewhere ? `On ${elsewhere}` : "Free agent"}</span>
              </button>
            );
          })}
        </div>
      </div>
      {SECTIONS.map((section) => {
        const rows = list
          .map((e, i) => ({ e, i }))
          .filter(({ e }) => section.slots.includes(e.slot))
          .sort((a, b) => SLOTS.indexOf(a.e.slot) - SLOTS.indexOf(b.e.slot));
        if (rows.length === 0 && section.title !== "Starters") return null;
        return (
          <div key={section.title} className="card mb-4 overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-24">{section.title}</th>
                  <th>Player</th>
                  <th>Today</th>
                  <th>Positions</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ e, i }) => (
                  <tr key={e.playerId}>
                    <td>
                      <select className="input w-auto py-1" value={e.slot} onChange={(ev) => update(i, { slot: ev.target.value })}>
                        {SLOTS.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span className="font-medium">{e.name}</span> <StatusBadge status={e.injury ?? null} />
                      <div className="text-xs text-slate-500">{[e.team, e.positions.join(", ")].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="text-xs">
                      {e.game ? (
                        <>
                          {e.game.home ? "vs" : "@"} {e.game.opponent}
                          <div className="text-slate-500">{fmtTipTime(e.game.tipTime, tz)}</div>
                        </>
                      ) : (
                        <span className="text-slate-400">{e.game === null ? "No game" : "—"}</span>
                      )}
                    </td>
                    <td>
                      <div className="flex gap-1">
                        {POSITIONS.map((p) => (
                          <label key={p} className="flex items-center gap-0.5 text-xs">
                            <input
                              type="checkbox"
                              checked={e.positions.includes(p)}
                              onChange={(ev) =>
                                update(i, { positions: ev.target.checked ? [...e.positions, p] : e.positions.filter((x) => x !== p) })
                              }
                            />
                            {p}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td>
                      <button className="text-xs text-red-600" onClick={() => setEntries(list.filter((_, j) => j !== i))}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-slate-500">
                      {current.isLoading ? "Loading…" : "No players yet. Search above to add them."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        );
      })}
      {(current.error || save.error) && <ErrorBox error={current.error ?? save.error} />}
      <button className="btn-primary mt-3" disabled={save.isPending || entries === null} onClick={() => save.mutate()}>
        {save.isPending ? "Saving…" : `Save ${team.name}`}
      </button>
    </>
  );
}
