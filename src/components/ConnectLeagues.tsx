"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "./fetcher";
import { ErrorBox } from "./ui";

interface Available {
  leagues: { leagueKey: string; name: string; season: number; numTeams: number; scoringType: string; connected: boolean }[];
}

export function ConnectLeagues() {
  const router = useRouter();
  const available = useQuery({ queryKey: ["yahoo-leagues"], queryFn: () => api<Available>("/api/leagues/available") });
  const connect = useMutation({
    mutationFn: (yahooLeagueKey: string) =>
      api<{ league: { id: number } }>("/api/leagues", { method: "POST", body: JSON.stringify({ yahooLeagueKey }) }),
    onSuccess: (r) => router.push(`/leagues/${r.league.id}/today`),
  });
  const [name, setName] = useState("");
  const manual = useMutation({
    mutationFn: () =>
      api<{ league: { id: number } }>("/api/leagues", {
        method: "POST",
        body: JSON.stringify({ manual: { name, season: new Date().getFullYear() } }),
      }),
    onSuccess: (r) => router.push(`/leagues/${r.league.id}/rules`),
  });

  return (
    <section className="mt-8 grid gap-6">
      <div>
        <h2 className="mb-2 font-semibold">Connect a Yahoo league</h2>
        {available.isLoading && <p className="text-sm text-slate-500">Looking up your Yahoo leagues…</p>}
        {available.error && <ErrorBox error={available.error} />}
        {connect.error && <ErrorBox error={connect.error} />}
        <div className="grid gap-2">
          {available.data?.leagues.length === 0 && <p className="text-sm text-slate-500">No NBA leagues found on your Yahoo account this season.</p>}
          {available.data?.leagues.map((l) => (
            <div key={l.leagueKey} className="card flex items-center justify-between p-3">
              <div className="text-sm">
                <div className="font-medium">{l.name}</div>
                <div className="text-slate-500">
                  {l.season} · {l.numTeams} teams · {l.scoringType}
                </div>
              </div>
              <button
                className="btn-primary"
                disabled={l.connected || connect.isPending}
                onClick={() => connect.mutate(l.leagueKey)}
              >
                {l.connected ? "Connected" : connect.isPending && connect.variables === l.leagueKey ? "Importing…" : "Connect"}
              </button>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h2 className="mb-2 font-semibold">Add a league by hand</h2>
        <p className="mb-2 text-sm text-slate-500">For a league that isn&apos;t on Yahoo. You&apos;ll upload its rules and enter the roster yourself.</p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) manual.mutate();
          }}
        >
          <input className="input" placeholder="League name" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn-secondary shrink-0" disabled={manual.isPending}>
            Create
          </button>
        </form>
        {manual.error && <ErrorBox error={manual.error} />}
      </div>
    </section>
  );
}
