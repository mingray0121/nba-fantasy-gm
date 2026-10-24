"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../fetcher";
import { Badge, Empty, ErrorBox, Loading, PageTitle, PlayerLink, StatusBadge } from "../ui";

interface TeamRow {
  id: number;
  name: string;
  positions: string[];
  injury: string | null;
  gp: number;
  min: number;
  pts: number;
  reb: number;
  ast: number;
  value: number | null;
  owner: string | null;
}

/** Search an NBA team and see this season's roster, positions and who owns each player in your league. */
export function NbaTeamsView({ leagueId }: { leagueId: number }) {
  const [abbr, setAbbr] = useState("");
  const [filter, setFilter] = useState("");
  const teams = useQuery({
    queryKey: ["nba-teams"],
    queryFn: () => api<{ teams: { abbreviation: string; name: string }[] }>(`/api/leagues/${leagueId}/nba-teams`),
  });
  const roster = useQuery({
    queryKey: ["league", leagueId, "nba-team", abbr],
    queryFn: () => api<{ team: { name: string }; players: TeamRow[] }>(`/api/leagues/${leagueId}/nba-teams?team=${abbr}`),
    enabled: abbr !== "",
  });
  const shown = (teams.data?.teams ?? []).filter(
    (t) => !filter || t.name.toLowerCase().includes(filter.toLowerCase()) || t.abbreviation.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <>
      <PageTitle title="NBA teams" subtitle="Search a team to see this season's roster, positions and who has each player in your league." />
      <div className="card mb-4 p-4">
        <input className="input mb-3" placeholder="Search a team, e.g. Lakers or LAL" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {teams.error && <ErrorBox error={teams.error} />}
        <div className="flex flex-wrap gap-1.5">
          {shown.map((t) => (
            <button
              key={t.abbreviation}
              className={t.abbreviation === abbr ? "btn-primary px-2.5 py-1 text-xs" : "btn-secondary px-2.5 py-1 text-xs"}
              onClick={() => setAbbr(t.abbreviation)}
              title={t.name}
            >
              {t.abbreviation}
            </button>
          ))}
        </div>
      </div>
      {!abbr && <Empty>Pick a team above.</Empty>}
      {roster.isLoading && <Loading />}
      {roster.error && <ErrorBox error={roster.error} />}
      {roster.data && (
        <div className="card overflow-x-auto">
          <h2 className="px-3 pt-3 font-semibold">{roster.data.team.name}</h2>
          <table className="table-base">
            <thead>
              <tr>
                <th>Player</th>
                <th>Pos</th>
                <th className="text-right">GP</th>
                <th className="text-right">MIN</th>
                <th className="text-right">PTS</th>
                <th className="text-right">REB</th>
                <th className="text-right">AST</th>
                <th className="text-right">Value</th>
                <th>In your league</th>
              </tr>
            </thead>
            <tbody>
              {roster.data.players.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap">
                    <PlayerLink id={p.id} name={p.name} leagueId={leagueId} className="font-medium" /> <StatusBadge status={p.injury} />
                  </td>
                  <td className="text-xs text-slate-500">{p.positions.join(", ") || "—"}</td>
                  <td className="text-right tabular-nums">{p.gp}</td>
                  <td className="text-right tabular-nums">{p.min.toFixed(1)}</td>
                  <td className="text-right tabular-nums">{p.pts.toFixed(1)}</td>
                  <td className="text-right tabular-nums">{p.reb.toFixed(1)}</td>
                  <td className="text-right tabular-nums">{p.ast.toFixed(1)}</td>
                  <td className={`text-right tabular-nums ${p.value != null && p.value < 0 ? "text-slate-400" : ""}`}>
                    {p.value == null ? "—" : p.value.toFixed(2)}
                  </td>
                  <td>{p.owner ? <span className="text-sm">{p.owner}</span> : <Badge tone="green">Free agent</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
