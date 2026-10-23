"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../fetcher";
import { Badge, Empty, ErrorBox, Loading, PageTitle } from "../ui";

type Category = {
  key: string;
  mine: number;
  opponent: number;
  mineSoFar: number;
  opponentSoFar: number;
  state: "winning" | "losing" | "close";
  decided: boolean;
};

type Result =
  | { kind: "categories"; week: number; teamName: string | null; opponentName: string | null; categories: Category[] }
  | {
      kind: "points";
      week: number;
      teamName: string | null;
      opponentName: string | null;
      mine: number;
      opponent: number;
      mineToDate: number;
      opponentToDate: number;
    };

interface Matchup {
  id: number;
  isMine: boolean;
  teamId: number;
  opponentTeamId: number;
  teamStats: Record<string, number>;
  opponentStats: Record<string, number>;
  teamPoints: number | null;
  opponentPoints: number | null;
  baselineThrough: string | null;
  result: Result;
}

interface Manual {
  week: { start: string; end: string };
  teams: { id: number; name: string; isMine: boolean }[];
  scoringType: string;
  inputs: string[];
}

interface Data {
  matchups: Matchup[];
  punted: string[];
  manual: Manual | null;
}

const fmt = (key: string, v: number) =>
  key.endsWith("%") ? v.toFixed(3).replace(/^0/, "") : key === "A/T" ? v.toFixed(2) : Math.round(v).toString();

/** Every matchup this week, yours first. Manual leagues can add and edit them. */
export function MatchupView({ leagueId }: { leagueId: number }) {
  const q = useQuery({
    queryKey: ["league", leagueId, "matchup"],
    queryFn: () => api<Data>(`/api/leagues/${leagueId}/matchup`),
  });
  const [adding, setAdding] = useState(false);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { matchups, punted, manual } = q.data!;
  const week = matchups[0]?.result.week;
  const taken = new Set(matchups.flatMap((m) => [m.teamId, m.opponentTeamId]));
  const free = manual?.teams.filter((t) => !taken.has(t.id)) ?? [];

  return (
    <>
      <PageTitle
        title={week ? `Week ${week} matchups` : "Matchups"}
        subtitle={manual ? `${manual.week.start} to ${manual.week.end}. Stats so far plus projected starts for the rest of the week.` : undefined}
        actions={
          manual && free.length >= 2 && !adding ? (
            <button className="btn-secondary" onClick={() => setAdding(true)}>
              + Add matchup
            </button>
          ) : null
        }
      />
      {manual && adding && (
        <MatchupForm
          leagueId={leagueId}
          manual={manual}
          teams={free}
          initial={{ teamId: free.find((t) => t.isMine)?.id ?? free[0]?.id, opponentTeamId: undefined }}
          onDone={() => setAdding(false)}
        />
      )}
      {matchups.length === 0 && !adding && (
        <Empty>{manual ? "No matchups yet. Add this week's matchups above." : "No matchup this week yet (or it hasn't synced). Press Refresh."}</Empty>
      )}
      {matchups.map((m) => (
        <MatchupCard
          key={m.id}
          leagueId={leagueId}
          m={m}
          punted={punted}
          manual={manual}
          teams={manual?.teams.filter((t) => !taken.has(t.id) || t.id === m.teamId || t.id === m.opponentTeamId) ?? []}
        />
      ))}
      {matchups.some((m) => m.result.kind === "categories") && (
        <p className="mt-2 text-xs text-slate-500">
          Your team&apos;s days so far use your saved lineups; other teams&apos; days use their best possible lineup. With matchup-aware weighting
          on, close categories in your matchup count 1.5× and decided ones 0.5× in today&apos;s start/bench values.
        </p>
      )}
    </>
  );
}

function MatchupCard({
  leagueId,
  m,
  punted,
  manual,
  teams,
}: {
  leagueId: number;
  m: Matchup;
  punted: string[];
  manual: Manual | null;
  teams: Manual["teams"];
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const remove = useMutation({
    mutationFn: () => api(`/api/leagues/${leagueId}/matchup?id=${m.id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["league", leagueId] }),
  });
  const r = m.result;
  const title = `${r.teamName ?? "Team"} vs ${r.opponentName ?? "opponent"}`;

  return (
    <div className="mb-6">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {m.isMine && <Badge tone="green">your matchup</Badge>}
        {manual && (
          <div className="ml-auto flex gap-3 text-xs">
            <button className="text-slate-500 underline" onClick={() => setEditing(!editing)}>
              {editing ? "Close" : "Edit"}
            </button>
            <button
              className="text-red-600 underline"
              onClick={() => {
                if (confirm(`Remove ${title}?`)) remove.mutate();
              }}
            >
              Remove
            </button>
          </div>
        )}
      </div>
      {remove.error && <ErrorBox error={remove.error} />}
      {manual && editing && (
        <MatchupForm
          leagueId={leagueId}
          manual={manual}
          teams={teams}
          initial={{
            teamId: m.teamId,
            opponentTeamId: m.opponentTeamId,
            teamStats: m.teamStats,
            opponentStats: m.opponentStats,
            teamPoints: m.teamPoints,
            opponentPoints: m.opponentPoints,
            through: m.baselineThrough,
          }}
          onDone={() => setEditing(false)}
        />
      )}
      {r.kind === "points" ? <PointsResult r={r} /> : <CategoriesResult r={r} punted={punted} />}
    </div>
  );
}

function PointsResult({ r }: { r: Extract<Result, { kind: "points" }> }) {
  const lead = r.mine - r.opponent;
  return (
    <div className="card grid grid-cols-2 gap-4 p-6 text-center">
      <div>
        <div className="text-sm text-slate-500">{r.teamName}</div>
        <div className="text-3xl font-semibold tabular-nums">{r.mine}</div>
        <div className="text-xs text-slate-500">{r.mineToDate} so far</div>
      </div>
      <div>
        <div className="text-sm text-slate-500">{r.opponentName}</div>
        <div className="text-3xl font-semibold tabular-nums">{r.opponent}</div>
        <div className="text-xs text-slate-500">{r.opponentToDate} so far</div>
      </div>
      <div className="col-span-2">
        <Badge tone={lead >= 0 ? "green" : "red"}>
          {lead >= 0 ? `${r.teamName} projected to win by ${lead.toFixed(1)}` : `${r.teamName} projected to lose by ${(-lead).toFixed(1)}`}
        </Badge>
      </div>
    </div>
  );
}

function CategoriesResult({ r, punted }: { r: Extract<Result, { kind: "categories" }>; punted: string[] }) {
  const won = r.categories.filter((c) => c.state === "winning").length;
  const lost = r.categories.filter((c) => c.state === "losing").length;
  const close = r.categories.filter((c) => c.state === "close");
  return (
    <>
      <p className="mb-2 text-sm text-slate-500">
        {r.teamName} projected {won}-{lost}-{close.length} (win-loss-close). Close: {close.map((c) => c.key).join(", ") || "none"}.
      </p>
      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Category</th>
              <th className="text-right">{r.teamName} so far</th>
              <th className="text-right">{r.opponentName} so far</th>
              <th className="text-right">{r.teamName} projected</th>
              <th className="text-right">{r.opponentName} projected</th>
              <th>Outlook</th>
            </tr>
          </thead>
          <tbody>
            {r.categories.map((c) => (
              <tr key={c.key} className={punted.includes(c.key) ? "opacity-50" : ""}>
                <td className="font-medium">
                  {c.key} {punted.includes(c.key) && <Badge>punted</Badge>}
                </td>
                <td className="text-right text-slate-500 tabular-nums">{fmt(c.key, c.mineSoFar)}</td>
                <td className="text-right text-slate-500 tabular-nums">{fmt(c.key, c.opponentSoFar)}</td>
                <td className="text-right tabular-nums">{fmt(c.key, c.mine)}</td>
                <td className="text-right tabular-nums">{fmt(c.key, c.opponent)}</td>
                <td>
                  <Badge tone={c.state === "winning" ? "green" : c.state === "losing" ? "red" : "amber"}>{c.state}</Badge>{" "}
                  {c.decided && <span className="text-xs text-slate-500">likely decided</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface FormInitial {
  teamId?: number;
  opponentTeamId?: number;
  teamStats?: Record<string, number>;
  opponentStats?: Record<string, number>;
  teamPoints?: number | null;
  opponentPoints?: number | null;
  through?: string | null;
}

/** Manual leagues: pick two teams and optionally type in their totals so far from Yahoo's matchup page. */
function MatchupForm({
  leagueId,
  manual,
  teams,
  initial,
  onDone,
}: {
  leagueId: number;
  manual: Manual;
  teams: Manual["teams"];
  initial: FormInitial;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [teamId, setTeamId] = useState<number | "">(initial.teamId ?? "");
  const [opponent, setOpponent] = useState<number | "">(initial.opponentTeamId ?? "");
  const [mine, setMine] = useState<Record<string, string>>(() => toText(initial.teamStats ?? {}));
  const [theirs, setTheirs] = useState<Record<string, string>>(() => toText(initial.opponentStats ?? {}));
  const [myPoints, setMyPoints] = useState(initial.teamPoints?.toString() ?? "");
  const [oppPoints, setOppPoints] = useState(initial.opponentPoints?.toString() ?? "");
  const [through, setThrough] = useState(initial.through ?? yesterdayEastern());
  const save = useMutation({
    mutationFn: () =>
      api(`/api/leagues/${leagueId}/matchup`, {
        method: "PUT",
        body: JSON.stringify({
          teamId,
          opponentTeamId: opponent,
          teamStats: toNumbers(mine),
          opponentStats: toNumbers(theirs),
          teamPoints: myPoints === "" ? null : Number(myPoints),
          opponentPoints: oppPoints === "" ? null : Number(oppPoints),
          throughDate: through,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["league", leagueId] });
      onDone();
    },
  });
  const isPoints = manual.scoringType === "h2h_points";
  const nameOf = (id: number | "") => teams.find((t) => t.id === id)?.name ?? "—";
  const teamSelect = (value: number | "", set: (v: number | "") => void, other: number | "") => (
    <select className="input" value={value} onChange={(e) => set(e.target.value === "" ? "" : Number(e.target.value))}>
      <option value="">Pick a team</option>
      {teams
        .filter((t) => t.id !== other)
        .map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {t.isMine ? " (you)" : ""}
          </option>
        ))}
    </select>
  );

  return (
    <div className="card mb-3 grid gap-3 p-4">
      {teams.length < 2 ? (
        <p className="text-sm text-slate-500">Add the teams on the Roster page first.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            Team
            {teamSelect(teamId, setTeamId, opponent)}
          </label>
          <label className="grid gap-1 text-sm">
            Opponent
            {teamSelect(opponent, setOpponent, teamId)}
          </label>
        </div>
      )}
      <p className="text-xs text-slate-500">
        Optional: totals from Yahoo&apos;s matchup page through the end of a day. Days after that are counted automatically from box scores.
        Leave blank to count the whole week automatically. Ratios use makes and attempts, like FGM and FGA.
      </p>
      <label className="flex items-center gap-2 text-sm">
        Totals through the end of (US Eastern)
        <input
          type="date"
          className="input w-auto py-1"
          value={through}
          min={manual.week.start}
          max={manual.week.end}
          onChange={(e) => setThrough(e.target.value)}
        />
      </label>
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th />
              {isPoints ? <th>Points</th> : manual.inputs.map((k) => <th key={k}>{k}</th>)}
            </tr>
          </thead>
          <tbody>
            {[
              { id: teamId, values: mine, set: setMine, points: myPoints, setPoints: setMyPoints },
              { id: opponent, values: theirs, set: setTheirs, points: oppPoints, setPoints: setOppPoints },
            ].map((row, i) => (
              <tr key={i}>
                <td className="text-sm whitespace-nowrap">{nameOf(row.id)}</td>
                {isPoints ? (
                  <td>
                    <input className="input w-24 py-1" inputMode="decimal" value={row.points} onChange={(e) => row.setPoints(e.target.value)} />
                  </td>
                ) : (
                  manual.inputs.map((k) => (
                    <td key={k}>
                      <input
                        className="input w-16 py-1"
                        inputMode="decimal"
                        value={row.values[k] ?? ""}
                        onChange={(e) => row.set({ ...row.values, [k]: e.target.value })}
                      />
                    </td>
                  ))
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {save.error && <ErrorBox error={save.error} />}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={save.isPending || teamId === "" || opponent === ""} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save matchup"}
        </button>
        <button className="btn-secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function toText(stats: Record<string, number>): Record<string, string> {
  return Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, String(v)]));
}

function toNumbers(values: Record<string, string>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, v]) => v.trim() !== "" && Number.isFinite(Number(v)))
      .map(([k, v]) => [k, Number(v)]),
  );
}

function yesterdayEastern(): string {
  return new Date(Date.now() - 86400000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
