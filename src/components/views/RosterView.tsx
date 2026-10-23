"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../fetcher";
import { fmtTipTime, useTimeZone } from "../timezone";
import { ErrorBox, PageTitle, SlotPill, StatusBadge } from "../ui";

/** Yahoo's roster order. */
const SLOTS = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "BN", "IL", "IL+"];
/** Same eligibility as the lineup optimizer: G takes PG/SG, F takes SF/PF, UTIL anyone with a position. */
function fits(slot: string, positions: string[]): boolean {
  if (slot === "BN" || slot === "IL" || slot === "IL+") return true;
  if (slot === "UTIL") return positions.length > 0;
  if (slot === "G") return positions.some((p) => p === "PG" || p === "SG");
  if (slot === "F") return positions.some((p) => p === "SF" || p === "PF");
  return positions.includes(slot);
}

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
  const rules = useQuery({
    queryKey: ["league", leagueId, "rules"],
    queryFn: () => api<{ active: { rules: { roster_slots: Record<string, number> } } | null }>(`/api/leagues/${leagueId}/rules`),
  });
  const capacity = rules.data?.active?.rules.roster_slots ?? null;
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [tz] = useTimeZone();
  const list = entries ?? current.data?.players ?? [];
  const used = (slot: string, except: number) => list.filter((x) => x.slot === slot && x.playerId !== except).length;
  const [search, setSearch] = useState("");
  const results = useQuery({
    queryKey: ["player-search", leagueId, search],
    queryFn: () => api<{ players: SearchResult[] }>(`/api/players/search?league=${leagueId}&q=${encodeURIComponent(search)}`),
    enabled: search.trim().length >= 2,
  });
  const save = useMutation({
    mutationFn: () =>
      api<{ locked: string[] }>(`/api/leagues/${leagueId}/roster`, {
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
  const [moving, setMoving] = useState<number | null>(null); // player being dragged or tapped
  const mover = list.find((x) => x.playerId === moving) ?? null;
  const board = buildBoard(list, capacity);
  /** Whether the moving player may go to this slot, swapping with its occupant if there is one. */
  const canDrop = (slot: string, occupant: Entry | null) =>
    mover != null &&
    occupant?.playerId !== mover.playerId &&
    fits(slot, mover.positions) &&
    (!occupant || fits(mover.slot, occupant.positions)) &&
    (occupant != null || mover.slot === slot || (capacity ? used(slot, mover.playerId) < (capacity[slot] ?? 0) : true));
  // Pointer-based dragging (works with a mouse and on phones): press a player, drag, release on a slot.
  const [ghost, setGhost] = useState<{ name: string; x: number; y: number } | null>(null);
  const releaseRef = useRef<(key: string | null, moved: boolean) => void>(() => {});
  releaseRef.current = (key, moved) => {
    const row = key ? board.find((r) => r.key === key) : undefined;
    if (row && mover && !(row.player?.playerId === mover.playerId)) drop(row.slot, row.player);
    else if (moved) setMoving(null); // dropped nowhere useful
    // A press without moving leaves the player selected, like tapping Move.
  };
  const startDrag = (e: Entry, ev: React.PointerEvent) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    setMoving(e.playerId);
    const x0 = ev.clientX;
    const y0 = ev.clientY;
    let moved = false;
    const onMove = (m: PointerEvent) => {
      if (Math.abs(m.clientX - x0) + Math.abs(m.clientY - y0) > 6) moved = true;
      if (moved) setGhost({ name: e.name, x: m.clientX, y: m.clientY });
    };
    const onUp = (u: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setGhost(null);
      const el = document.elementFromPoint(u.clientX, u.clientY)?.closest("[data-row]");
      releaseRef.current(moved ? (el?.getAttribute("data-row") ?? null) : null, moved);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  /** Moves the moving player into a slot; its occupant takes the mover's old slot (like Yahoo). */
  const drop = (slot: string, occupant: Entry | null) => {
    if (!mover || !canDrop(slot, occupant)) return setMoving(null);
    setEntries(
      list.map((x) =>
        x.playerId === mover.playerId ? { ...x, slot } : occupant && x.playerId === occupant.playerId ? { ...x, slot: mover.slot } : x,
      ),
    );
    setMoving(null);
  };

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
      {ghost && (
        <div
          className="pointer-events-none fixed z-50 rounded-md bg-court-600 px-2 py-1 text-xs text-white shadow"
          style={{ left: ghost.x + 8, top: ghost.y + 8 }}
        >
          {ghost.name}
        </div>
      )}
      <p className="mb-2 text-xs text-slate-500">
        Drag a player onto another slot to move him there, or tap Move and then a slot. Taking a filled slot swaps the two players. Only
        slots the player can play light up.
      </p>
      {SECTIONS.map((section) => {
        const rows = board.filter((r) => section.slots.includes(r.slot));
        if (rows.length === 0) return null;
        return (
          <div key={section.title} className="card mb-4 overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-16">{section.title}</th>
                  <th>Player</th>
                  <th>Today</th>
                  <th>Positions</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const e = row.player;
                  const i = e ? list.indexOf(e) : -1;
                  const target = mover != null && canDrop(row.slot, e);
                  const dim = mover != null && !target && e?.playerId !== mover.playerId;
                  return (
                    <tr
                      key={row.key}
                      className={`${target ? "cursor-pointer bg-green-50 dark:bg-green-950" : ""} ${dim ? "opacity-40" : ""} ${
                        e && e.playerId === moving ? "bg-slate-100 dark:bg-slate-800" : ""
                      }`}
                      data-row={row.key}
                      onClick={() => target && drop(row.slot, e)}
                    >
                      <td>
                        <SlotPill slot={row.slot} />
                        {row.problem && <div className="mt-1 text-xs text-red-600">{row.problem}</div>}
                      </td>
                      {e ? (
                        <>
                          <td onPointerDown={(ev) => startDrag(e, ev)} className="cursor-grab touch-none select-none">
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
                                <label key={p} className="flex items-center gap-0.5 text-xs" onClick={(ev) => ev.stopPropagation()}>
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
                          <td className="text-right whitespace-nowrap">
                            <button
                              className="mr-3 text-xs text-slate-500 underline"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setMoving(moving === e.playerId ? null : e.playerId);
                              }}
                            >
                              {moving === e.playerId ? "Cancel" : "Move"}
                            </button>
                            <button
                              className="text-xs text-red-600"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setEntries(list.filter((_, j) => j !== i));
                              }}
                            >
                              Remove
                            </button>
                          </td>
                        </>
                      ) : (
                        <td colSpan={4} className="text-slate-400">
                          {current.isLoading ? "Loading…" : "(Empty)"}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      {(current.error || save.error) && <ErrorBox error={current.error ?? save.error} />}
      {save.data?.locked.length ? <LockedNotice notes={save.data.locked} /> : null}
      <button className="btn-primary mt-3" disabled={save.isPending || entries === null} onClick={() => save.mutate()}>
        {save.isPending ? "Saving…" : `Save ${team.name}`}
      </button>
    </>
  );
}

interface BoardRow {
  key: string;
  slot: string;
  player: Entry | null;
  problem?: string;
}

/**
 * Yahoo-style slot rows: one row per roster slot in order (PG, SG, G, ... BN, BN, BN, IL ...),
 * filled with the players in that slot. Players beyond a slot's count, or in a slot they
 * can't play, get flagged rows so nothing is hidden.
 */
function buildBoard(list: Entry[], capacity: Record<string, number> | null): BoardRow[] {
  const rows: BoardRow[] = [];
  for (const slot of SLOTS) {
    const players = list.filter((e) => e.slot === slot);
    const count = capacity ? (capacity[slot] ?? 0) : players.length;
    for (let n = 0; n < Math.max(count, players.length); n++) {
      const player = players[n] ?? null;
      const problem =
        n >= count
          ? `Only ${count} ${slot} slot${count === 1 ? "" : "s"}`
          : player && !fits(slot, player.positions)
            ? `Can't play ${slot}`
            : undefined;
      rows.push({ key: `${slot}-${n}`, slot, player, problem });
    }
  }
  return rows;
}

/** Players whose game had started keep today's slot (Yahoo locks each player at tip-off). */
export function LockedNotice({ notes }: { notes: string[] }) {
  return (
    <div className="card mt-3 border-amber-200 p-3 text-sm text-amber-800 dark:border-amber-900 dark:text-amber-300">
      <p className="font-medium">Some changes start tomorrow:</p>
      <ul className="list-disc pl-5">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}
