"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../fetcher";
import { ErrorBox, Loading, PageTitle } from "../ui";

interface Settings {
  windowWeights: { season: number; last14: number; last7: number };
  puntCategories: string[];
  dropMargin: number;
  matchupAware: boolean;
}

export function SettingsView({ leagueId }: { leagueId: number }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["league", leagueId, "settings"], queryFn: () => api<{ settings: Settings }>(`/api/leagues/${leagueId}/settings`) });
  const rules = useQuery({
    queryKey: ["league", leagueId, "rules"],
    queryFn: () => api<{ active: { rules: { scoring_type: string; categories: string[] } } | null }>(`/api/leagues/${leagueId}/rules`),
  });
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    if (q.data) setS(q.data.settings);
  }, [q.data]);
  const save = useMutation({
    mutationFn: (body: Settings) => api(`/api/leagues/${leagueId}/settings`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["league", leagueId] }),
  });

  if (q.isLoading || !s) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const categories = rules.data?.active?.rules.categories ?? [];
  const isCats = rules.data?.active?.rules.scoring_type !== "h2h_points";
  const pct = (v: number) => Math.round(v * 100);

  return (
    <>
      <PageTitle title="League settings" subtitle="How the model values players in this league only." />
      <form
        className="card grid max-w-xl gap-5 p-4 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(s);
        }}
      >
        <fieldset>
          <legend className="font-medium">Projection window weights (%)</legend>
          <p className="mb-2 text-xs text-slate-500">How much the season, last 10 games and last 5 games count. They are rescaled to add up to 100.</p>
          <div className="grid grid-cols-3 gap-2">
            {(["season", "last14", "last7"] as const).map((k) => (
              <label key={k} className="grid gap-1">
                <span className="text-xs text-slate-500">{k === "season" ? "Season" : k === "last14" ? "Last 10 games" : "Last 5 games"}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="input"
                  value={pct(s.windowWeights[k])}
                  onChange={(e) => setS({ ...s, windowWeights: { ...s.windowWeights, [k]: Number(e.target.value) / 100 } })}
                />
              </label>
            ))}
          </div>
        </fieldset>

        {isCats && (
          <fieldset>
            <legend className="font-medium">Punted categories</legend>
            <p className="mb-2 text-xs text-slate-500">Punted categories are ignored when valuing players.</p>
            <div className="flex flex-wrap gap-3">
              {categories.map((c) => (
                <label key={c} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={s.puntCategories.includes(c)}
                    onChange={(e) =>
                      setS({ ...s, puntCategories: e.target.checked ? [...s.puntCategories, c] : s.puntCategories.filter((x) => x !== c) })
                    }
                  />
                  {c}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <label className="grid gap-1">
          <span className="font-medium">Drop margin</span>
          <span className="text-xs text-slate-500">
            How much more per game a free agent must be worth before a drop is suggested ({isCats ? "in z-score units" : "in fantasy points"}).
          </span>
          <input type="number" step="0.1" min={0} className="input w-32" value={s.dropMargin} onChange={(e) => setS({ ...s, dropMargin: Number(e.target.value) })} />
        </label>

        {isCats && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={s.matchupAware} onChange={(e) => setS({ ...s, matchupAware: e.target.checked })} />
            <span>Weight close categories in this week&apos;s matchup more when choosing starters</span>
          </label>
        )}

        {save.error && <ErrorBox error={save.error} />}
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save and recompute"}
          </button>
          {save.isSuccess && <span className="text-xs text-emerald-600">Saved</span>}
        </div>
      </form>
    </>
  );
}
