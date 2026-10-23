"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../fetcher";
import { Badge, Empty, ErrorBox, Loading, PageTitle } from "../ui";

type Result =
  | {
      kind: "categories";
      week: number;
      opponentName: string | null;
      categories: { key: string; mine: number; opponent: number; mineSoFar: number; opponentSoFar: number; state: "winning" | "losing" | "close"; decided: boolean }[];
    }
  | {
      kind: "points";
      week: number;
      opponentName: string | null;
      mine: number;
      opponent: number;
      mineToDate: number;
      opponentToDate: number;
    };

interface Manual {
  week: { start: string; end: string };
  teams: { id: number; name: string }[];
  scoringType: string;
  inputs: string[];
  opponentTeamId: number | null;
  myStats: Record<string, number>;
  opponentStats: Record<string, number>;
  myPoints: number | null;
  opponentPoints: number | null;
  baselineThrough: string | null;
}

const fmt = (key: string, v: number) =>
  key.endsWith("%") ? v.toFixed(3).replace(/^0/, "") : key === "A/T" ? v.toFixed(2) : Math.round(v).toString();

export function MatchupView({ leagueId }: { leagueId: number }) {
  const q = useQuery({
    queryKey: ["league", leagueId, "matchup"],
    queryFn: () => api<{ result: Result | null; punted: string[]; manual: Manual | null }>(`/api/leagues/${leagueId}/matchup`),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const manual = q.data!.manual;
  const setup = manual && <ManualSetup key={JSON.stringify(manual)} leagueId={leagueId} manual={manual} open={!q.data!.result} />;
  return (
    <>
      {setup}
      <Projection r={q.data!.result} manual={Boolean(manual)} punted={q.data!.punted} />
    </>
  );
}

function Projection({ r, manual, punted }: { r: Result | null; manual: boolean; punted: string[] }) {
  if (!r) {
    return (
      <Empty>
        {manual
          ? "Pick this week's opponent above to see the projection."
          : "No matchup this week yet (or it hasn't synced). Press Refresh."}
      </Empty>
    );
  }

  if (r.kind === "points") {
    const lead = r.mine - r.opponent;
    return (
      <>
        <PageTitle
          title={`Week ${r.week} vs ${r.opponentName ?? "opponent"}`}
          subtitle="Projected final score: points so far plus projected starts"
        />
        <div className="card grid grid-cols-2 gap-4 p-6 text-center">
          <div>
            <div className="text-sm text-slate-500">You</div>
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
              {lead >= 0 ? `Projected to win by ${lead.toFixed(1)}` : `Projected to lose by ${(-lead).toFixed(1)}`}
            </Badge>
          </div>
        </div>
      </>
    );
  }

  const won = r.categories.filter((c) => c.state === "winning").length;
  const lost = r.categories.filter((c) => c.state === "losing").length;
  const close = r.categories.filter((c) => c.state === "close");
  return (
    <>
      <PageTitle
        title={`Week ${r.week} vs ${r.opponentName ?? "opponent"}`}
        subtitle={`Projected ${won}-${lost}-${close.length} (win-loss-close). Chase the close ones: ${close.map((c) => c.key).join(", ") || "none"}.`}
      />
      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Category</th>
              <th className="text-right">You so far</th>
              <th className="text-right">Them so far</th>
              <th className="text-right">You (projected)</th>
              <th className="text-right">Them (projected)</th>
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
      <p className="mt-2 text-xs text-slate-500">
        With matchup-aware weighting on, close categories count 1.5× and decided ones 0.5× in today&apos;s start/bench values.
      </p>
    </>
  );
}

/** Manual leagues: choose this week's opponent and type in the stats so far from Yahoo's matchup page. */
function ManualSetup({ leagueId, manual, open }: { leagueId: number; manual: Manual; open: boolean }) {
  const qc = useQueryClient();
  const [show, setShow] = useState(open);
  const [opponent, setOpponent] = useState<number | "">(manual.opponentTeamId ?? "");
  const [mine, setMine] = useState<Record<string, string>>(() => toText(manual.myStats));
  const [theirs, setTheirs] = useState<Record<string, string>>(() => toText(manual.opponentStats));
  const [myPoints, setMyPoints] = useState(manual.myPoints?.toString() ?? "");
  const [oppPoints, setOppPoints] = useState(manual.opponentPoints?.toString() ?? "");
  const [through, setThrough] = useState(manual.baselineThrough ?? yesterdayEastern());
  const save = useMutation({
    mutationFn: () =>
      api(`/api/leagues/${leagueId}/matchup`, {
        method: "PUT",
        body: JSON.stringify({
          opponentTeamId: opponent,
          myStats: toNumbers(mine),
          opponentStats: toNumbers(theirs),
          myPoints: myPoints === "" ? null : Number(myPoints),
          opponentPoints: oppPoints === "" ? null : Number(oppPoints),
          throughDate: through,
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["league", leagueId] }),
  });
  const isPoints = manual.scoringType === "h2h_points";

  return (
    <div className="card mb-4 p-4">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setShow(!show)}>
        <span className="font-medium">
          This week&apos;s matchup ({manual.week.start} to {manual.week.end})
        </span>
        <span className="text-xs text-slate-500">{show ? "Hide" : "Edit"}</span>
      </button>
      {show && (
        <div className="mt-3 grid gap-3">
          {manual.teams.length === 0 ? (
            <p className="text-sm text-slate-500">Add your opponent&apos;s team on the Roster page first.</p>
          ) : (
            <label className="grid gap-1 text-sm">
              Opponent
              <select className="input" value={opponent} onChange={(e) => setOpponent(e.target.value === "" ? "" : Number(e.target.value))}>
                <option value="">Pick a team</option>
                {manual.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="text-xs text-slate-500">
            Optional: totals from Yahoo&apos;s matchup page through the end of a day. Days after that are counted automatically from box
            scores: your saved lineup for you, the best possible lineup for your opponent. Leave blank to count the whole week
            automatically. Ratios use makes and attempts, like FGM and FGA.
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
                  { label: "You", values: mine, set: setMine, points: myPoints, setPoints: setMyPoints },
                  { label: "Opponent", values: theirs, set: setTheirs, points: oppPoints, setPoints: setOppPoints },
                ].map((row) => (
                  <tr key={row.label}>
                    <td className="text-sm whitespace-nowrap">{row.label}</td>
                    {isPoints ? (
                      <td>
                        <input
                          className="input w-24 py-1"
                          inputMode="decimal"
                          value={row.points}
                          onChange={(e) => row.setPoints(e.target.value)}
                        />
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
          <div>
            <button className="btn-primary" disabled={save.isPending || opponent === ""} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : "Save matchup"}
            </button>
          </div>
        </div>
      )}
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
  const d = new Date(Date.now() - 86400000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
