"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./fetcher";
import { timeAgo } from "./ui";
import { TimeZoneToggle } from "./timezone";

interface Props {
  league: { id: number; name: string; source: string; scoringType: string | null; lastSyncAt: string | null };
  leagues: { id: number; name: string }[];
  /** Demo visitors: show what the demo is and hide data refresh. */
  demo?: boolean;
}

export function LeagueNav({ league, leagues, demo }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const base = `/leagues/${league.id}`;
  const tabs = [
    ["today", "Today"],
    ["week", "Week"],
    ["matchup", "Matchup"],
    ["suggestions", "Suggestions"],
    ["nba-teams", "NBA teams"],
    ...(league.source === "manual"
      ? [
          ["roster", "Roster"],
          ["transactions", "Transactions"],
        ]
      : []),
    ["rules", "Rules"],
    ["settings", "Settings"],
  ];
  const section = pathname.split("/")[3] ?? "today";

  const refresh = useMutation({
    mutationFn: () => api<{ ok: boolean }>(`/api/leagues/${league.id}/sync`, { method: "POST" }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["league", league.id] });
      router.refresh();
    },
  });

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/85 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/85">
      {demo && (
        <div className="bg-ember-500 px-4 py-1.5 text-center text-xs font-medium text-white">
          Demo league with made-up teams. Change anything you like; it resets when you close the browser.
        </div>
      )}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 pt-3 pb-2">
        <Link href="/leagues" className="flex items-center gap-2 text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          <span className="grid size-6 place-items-center rounded-full bg-ember-500 text-[10px] font-bold text-white shadow-sm">GM</span>
          <span className="hidden sm:inline">Lineup Assistant</span>
        </Link>
        <span className="text-slate-300 dark:text-slate-700">/</span>
        <select
          aria-label="League"
          className="input w-auto max-w-[16rem] border-transparent bg-transparent py-1 font-medium hover:border-slate-200 dark:bg-transparent"
          value={league.id}
          onChange={(e) => router.push(`/leagues/${e.target.value}/${section}`)}
        >
          {leagues.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          <TimeZoneToggle />
          {!demo && <span className="hidden md:inline">Updated {timeAgo(league.lastSyncAt)}</span>}
          {!demo && (
            <button className="btn-secondary px-3 py-1.5 text-xs" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
              {refresh.isPending ? "Refreshing…" : "Refresh"}
            </button>
          )}
        </div>
      </div>
      <nav className="mx-auto flex max-w-6xl gap-5 overflow-x-auto px-4">
        {tabs.map(([slug, label]) => (
          <Link
            key={slug}
            href={`${base}/${slug}`}
            className={`-mb-px border-b-2 py-2.5 text-sm whitespace-nowrap transition-colors ${
              section === slug
                ? "border-ember-500 font-medium text-slate-900 dark:text-slate-100"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {refresh.data && !refresh.data.ok && (
        <p className="mx-auto max-w-6xl px-4 pb-2 text-xs text-rose-600">Some refresh steps failed; check the league&apos;s sync log.</p>
      )}
    </header>
  );
}
