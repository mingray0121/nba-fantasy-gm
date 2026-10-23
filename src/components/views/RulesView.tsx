"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../fetcher";
import { Badge, ErrorBox, Loading, PageTitle } from "../ui";

interface RulesResponse {
  active: {
    versionId: number;
    version: number;
    source: string;
    createdAt: string;
    rules: {
      scoring_type: string;
      categories: string[];
      point_weights: Record<string, number>;
      roster_slots: Record<string, number>;
      games_played_limit: number | null;
      max_adds_per_week: number | null;
    };
    input: unknown;
  } | null;
  versions: { id: number; version: number; source: string; scoringType: string; uploadedFileName: string | null; createdAt: string }[];
}

const SOURCE: Record<string, string> = { yahoo_import: "Yahoo import", manual_edit: "Edited", file_upload: "Uploaded" };

const CSV_SAMPLE = `type,key,value
setting,scoring_type,h2h_categories
setting,max_adds_per_week,4
setting,games_played_limit,
category,FG%,
category,FT%,
category,3PM,
category,PTS,
category,REB,
category,AST,
category,STL,
category,BLK,
category,TO,
slot,PG,1
slot,SG,1
slot,G,1
slot,SF,1
slot,PF,1
slot,F,1
slot,C,2
slot,UTIL,2
slot,BN,3
slot,IL,2`;

export function RulesView({ leagueId }: { leagueId: number }) {
  const qc = useQueryClient();
  const key = ["league", leagueId, "rules"];
  const q = useQuery({ queryKey: key, queryFn: () => api<RulesResponse>(`/api/leagues/${leagueId}/rules`) });
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (q.data?.active) setText(JSON.stringify(q.data.active.input, null, 2));
  }, [q.data?.active]);

  const done = () => qc.invalidateQueries({ queryKey: ["league", leagueId] });
  const save = useMutation({
    mutationFn: () => {
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error("That isn't valid JSON");
      }
      return api(`/api/leagues/${leagueId}/rules`, { method: "PUT", body: JSON.stringify(body) });
    },
    onSuccess: done,
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api(`/api/leagues/${leagueId}/rules/upload`, { method: "POST", body: fd });
    },
    onSuccess: done,
  });
  const reimport = useMutation({ mutationFn: () => api(`/api/leagues/${leagueId}/rules/reimport`, { method: "POST" }), onSuccess: done });
  const activate = useMutation({
    mutationFn: (versionId: number) => api(`/api/leagues/${leagueId}/rules/activate`, { method: "POST", body: JSON.stringify({ versionId }) }),
    onSuccess: done,
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const a = q.data!.active;
  const busy = save.isPending || upload.isPending || reimport.isPending || activate.isPending;
  const error = save.error ?? upload.error ?? reimport.error ?? activate.error;

  return (
    <>
      <PageTitle
        title="League rules"
        subtitle="Changes here save a new version for this league only. Other leagues are never touched."
        actions={
          <button className="btn-secondary" disabled={busy} onClick={() => reimport.mutate()}>
            {reimport.isPending ? "Importing…" : "Re-import from Yahoo"}
          </button>
        }
      />
      {error && <ErrorBox error={error} />}
      {a && (
        <div className="card mb-4 grid gap-3 p-4 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs text-slate-500 uppercase">Active version</div>
            <div>
              v{a.version} · {SOURCE[a.source] ?? a.source} · {new Date(a.createdAt).toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 uppercase">Scoring</div>
            <div>{a.rules.scoring_type.replace("_", " ")}</div>
          </div>
          <div className="sm:col-span-2">
            <div className="text-xs text-slate-500 uppercase">{a.rules.scoring_type === "h2h_points" ? "Point weights" : "Categories"}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {a.rules.scoring_type === "h2h_points"
                ? Object.entries(a.rules.point_weights).map(([k, w]) => (
                    <Badge key={k} tone="blue">
                      {k} {w > 0 ? "+" : ""}
                      {w}
                    </Badge>
                  ))
                : a.rules.categories.map((c) => (
                    <Badge key={c} tone="blue">
                      {c}
                    </Badge>
                  ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <div className="text-xs text-slate-500 uppercase">Roster slots</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {Object.entries(a.rules.roster_slots).map(([s, n]) => (
                <Badge key={s}>
                  {s} × {n}
                </Badge>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 uppercase">Games-played limit</div>
            <div>{a.rules.games_played_limit ?? "None"}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 uppercase">Max adds per week</div>
            <div>{a.rules.max_adds_per_week ?? "Unlimited"}</div>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="font-semibold">Edit</h2>
          <p className="mb-2 text-xs text-slate-500">
            JSON in the upload format. A points league uses <code>point_weights</code>, e.g. {"{"}&quot;PTS&quot;: 1, &quot;TO&quot;: -1{"}"}, instead of{" "}
            <code>categories</code>.
          </p>
          <textarea className="input h-80 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
          <button className="btn-primary mt-2" disabled={busy} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save as new version"}
          </button>
        </section>

        <section className="grid content-start gap-4">
          <div className="card p-4">
            <h2 className="font-semibold">Upload a rule file</h2>
            <p className="mb-2 text-xs text-slate-500">A .json file in the format on the left, or a .csv with columns type,key,value.</p>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.csv,application/json,text/csv"
              className="text-sm"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f);
                if (fileRef.current) fileRef.current.value = "";
              }}
            />
            {upload.isPending && <p className="mt-1 text-xs">Uploading…</p>}
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-slate-500">CSV example</summary>
              <pre className="mt-1 overflow-x-auto rounded bg-slate-100 p-2 dark:bg-slate-800">{CSV_SAMPLE}</pre>
            </details>
          </div>

          <div className="card p-4">
            <h2 className="mb-2 font-semibold">Version history</h2>
            <ul className="grid gap-1 text-sm">
              {q.data!.versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2">
                  <span>
                    v{v.version} · {SOURCE[v.source] ?? v.source}
                    {v.uploadedFileName ? ` (${v.uploadedFileName})` : ""} · {new Date(v.createdAt).toLocaleDateString()}
                  </span>
                  {a?.versionId === v.id ? (
                    <Badge tone="green">active</Badge>
                  ) : (
                    <button className="btn-secondary py-0.5 text-xs" disabled={busy} onClick={() => activate.mutate(v.id)}>
                      Use this
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </>
  );
}
