"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./fetcher";
import { timeAgo } from "./ui";

interface Props {
  league: { id: number; name: string; source: string; scoringType: string | null; lastSyncAt: string | null };
  leagues: { id: number; name: string }[];
}

export function LeagueNav({ league, leagues }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const base = `/leagues/${league.id}`;
  const tabs = [
    ["today", "Today"],
    ["week", "Week"],
    ["matchup", "Matchup"],
    ["add-drop", "Add / drop"],
    ...(league.source === "manual" ? [["roster", "Roster"]] : []),
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
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-2">
        <Link href="/leagues" className="text-sm font-semibold text-court-600">
          Lineup Assistant
        </Link>
        <select
          aria-label="League"
          className="input w-auto max-w-[14rem] py-1"
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
          <span className="hidden sm:inline">Updated {timeAgo(league.lastSyncAt)}</span>
          <button className="btn-secondary py-1" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            {refresh.isPending ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 pb-2">
        {tabs.map(([slug, label]) => (
          <Link
            key={slug}
            href={`${base}/${slug}`}
            className={`rounded-md px-3 py-1.5 text-sm whitespace-nowrap ${
              section === slug ? "bg-court-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {refresh.data && !refresh.data.ok && (
        <p className="mx-auto max-w-5xl px-4 pb-2 text-xs text-red-600">Some refresh steps failed; check the league&apos;s sync log.</p>
      )}
    </header>
  );
}
