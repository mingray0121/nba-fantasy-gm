"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../fetcher";
import { ActionBadge, actionTarget, Badge, Empty, ErrorBox, Loading, PageTitle, PlayerLink, SlotPill } from "../ui";
import { UpcomingPanel } from "./UpcomingPanel";
import type { LineupRow } from "@/lib/data/views";
import type { AddDropSuggestion } from "@/lib/engine/addDrop";
import type { TradeIdea } from "@/lib/engine/trades";

interface Data {
  date: string;
  lineup: { changes: LineupRow[]; firstTip: string | null; days: { day: string; starts: number; benchedWithGame: string[] }[] };
  freeAgents: { swaps: AddDropSuggestion[]; addsUsed: number; maxAdds: number | null; addsLeft: number | null };
  trades: TradeIdea[];
}

const dayLabel = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC" });

function Section({ n, title, subtitle, children }: { n: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="grid size-6 place-items-center rounded-full bg-ember-500 text-xs font-semibold text-white">{n}</span>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {subtitle && <span className="text-sm text-slate-500">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

/** Part 1: your lineup. Part 2: moves (free agents, then trades with other teams). */
export function SuggestionsView({ leagueId }: { leagueId: number }) {
  const q = useQuery({
    queryKey: ["league", leagueId, "suggestions"],
    queryFn: () => api<Data>(`/api/leagues/${leagueId}/suggestions`),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const fa = d.freeAgents;

  return (
    <>
      <PageTitle title="Suggestions" subtitle="Your lineup first, then moves: free-agent swaps and trades with other teams." />

      <Section n="1" title="Your lineup" subtitle="today and the rest of this week">
        <div className={`card mb-3 border-l-4 p-5 ${d.lineup.changes.length ? "border-l-ember-500" : "border-l-emerald-500"}`}>
          {d.lineup.changes.length === 0 ? (
            <p className="text-sm">
              <span className="font-medium">You&apos;re set for today.</span>{" "}
              <span className="text-slate-500">Your lineup is already the best one.</span>
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {d.lineup.changes.map((r) => (
                <li key={r.playerId} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
                  <ActionBadge action={r.action} />
                  <PlayerLink id={r.playerId} name={r.name} leagueId={leagueId} className="font-medium" />
                  <span className="ml-auto flex items-center gap-1 text-xs text-slate-500">
                    <SlotPill slot={r.currentSlot} muted />→<SlotPill slot={actionTarget(r)} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
          {d.lineup.days.map((day) => (
            <div key={day.day} className="card p-3 text-sm">
              <div className="text-xs text-slate-500">{dayLabel(day.day)}</div>
              <div className="text-xl font-semibold tabular-nums">{day.starts}</div>
              <div className="text-[11px] text-slate-500">starts</div>
              {day.benchedWithGame.length > 0 && (
                <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-300" title={day.benchedWithGame.join(", ")}>
                  {day.benchedWithGame.length} with a game but no slot
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section n="1B" title="Upcoming games" subtitle="US game nights, tip times on your clock; tap a team, pick a slot, tick players to compare">
        <UpcomingPanel leagueId={leagueId} />
      </Section>

      <Section
        n="2A"
        title="Free agents"
        subtitle={fa.maxAdds != null ? `${fa.addsLeft} of ${fa.maxAdds} adds left this week` : "ranked by rest-of-week gain"}
      >
        {fa.swaps.length === 0 ? (
          <Empty>
            {fa.addsLeft === 0 ? "No adds left this week." : "No free agent beats your weakest player by your drop margin right now."}
          </Empty>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Add</th>
                  <th>Drop</th>
                  <th className="text-right">This week</th>
                  <th className="text-right">Per game</th>
                  <th className="hidden md:table-cell">Why</th>
                </tr>
              </thead>
              <tbody>
                {fa.swaps.map((s) => (
                  <tr key={`${s.add.playerId}-${s.drop.playerId}`}>
                    <td className="font-medium text-emerald-700 dark:text-emerald-400">+ <PlayerLink id={s.add.playerId} name={s.add.name} leagueId={leagueId} /></td>
                    <td className="text-rose-600">− <PlayerLink id={s.drop.playerId} name={s.drop.name} leagueId={leagueId} /></td>
                    <td className="text-right font-medium">
                      {s.restOfWeekGain > 0 ? "+" : ""}
                      {s.restOfWeekGain.toFixed(2)}
                    </td>
                    <td className="text-right text-slate-500">+{s.perGameGain.toFixed(2)}</td>
                    <td className="hidden text-xs text-slate-500 md:table-cell">{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section n="2B" title="Trades" subtitle="the other team loses nothing; both rosters stay legal">
        {d.trades.length === 0 ? (
          <Empty>No trade helps you without costing the other team right now.</Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {d.trades.map((t) => (
              <div
                key={`${t.partnerTeamId}-${t.give.map((p) => p.playerId).join()}-${t.get.map((p) => p.playerId).join()}`}
                className="card p-4"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">with {t.partnerName}</span>
                  <Badge tone="green">you +{t.myGain}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="mb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">You give</div>
                    {t.give.map((p) => (
                      <div key={p.playerId} className="text-rose-600">
                        − <PlayerLink id={p.playerId} name={p.name} leagueId={leagueId} />
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">You get</div>
                    {t.get.map((p) => (
                      <div key={p.playerId} className="font-medium text-emerald-700 dark:text-emerald-400">
                        + <PlayerLink id={p.playerId} name={p.name} leagueId={leagueId} />
                      </div>
                    ))}
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  {t.reason}. They gain +{t.partnerGain}.
                </p>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Values are rest-of-season z-scores, weighted toward each team&apos;s weakest categories, so both sides get what they need.
        </p>
      </Section>
    </>
  );
}
