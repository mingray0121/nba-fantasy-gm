"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../fetcher";
import { Badge, Empty, ErrorBox, Loading, PageTitle } from "../ui";

type Result =
  | { kind: "categories"; week: number; opponentName: string | null; categories: { key: string; mine: number; opponent: number; state: "winning" | "losing" | "close"; decided: boolean }[] }
  | { kind: "points"; week: number; opponentName: string | null; mine: number; opponent: number; mineToDate: number; opponentToDate: number };

const fmt = (key: string, v: number) => (key.endsWith("%") ? v.toFixed(3).replace(/^0/, "") : Math.round(v).toString());

export function MatchupView({ leagueId }: { leagueId: number }) {
  const q = useQuery({
    queryKey: ["league", leagueId, "matchup"],
    queryFn: () => api<{ result: Result | null; punted: string[] }>(`/api/leagues/${leagueId}/matchup`),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const r = q.data!.result;
  if (!r) return <Empty>No matchup this week yet (or it hasn&apos;t synced). Press Refresh.</Empty>;

  if (r.kind === "points") {
    const lead = r.mine - r.opponent;
    return (
      <>
        <PageTitle title={`Week ${r.week} vs ${r.opponentName ?? "opponent"}`} subtitle="Projected final score: points so far plus projected starts" />
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
            <Badge tone={lead >= 0 ? "green" : "red"}>{lead >= 0 ? `Projected to win by ${lead.toFixed(1)}` : `Projected to lose by ${(-lead).toFixed(1)}`}</Badge>
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
              <th className="text-right">You</th>
              <th className="text-right">Them</th>
              <th>Outlook</th>
            </tr>
          </thead>
          <tbody>
            {r.categories.map((c) => (
              <tr key={c.key} className={q.data!.punted.includes(c.key) ? "opacity-50" : ""}>
                <td className="font-medium">
                  {c.key} {q.data!.punted.includes(c.key) && <Badge>punted</Badge>}
                </td>
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
