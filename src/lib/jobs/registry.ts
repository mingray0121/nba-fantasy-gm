import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { runLogged, type JobResult } from "./run";
import { computeProjections, syncBoxScores, syncInjuries, syncSchedule } from "./shared";
import { computeValues, importRules, syncFreeAgents, syncMatchup, syncRosters } from "./league";

type SharedJob = { scope: "shared"; run: () => Promise<JobResult> };
type LeagueJob = { scope: "league"; run: (leagueId: number) => Promise<JobResult> };

/** Every job the scheduler can call at /api/jobs/{name}. */
export const JOBS: Record<string, SharedJob | LeagueJob> = {
  "rules-import": { scope: "league", run: importRules },
  "roster-sync": { scope: "league", run: (id) => syncRosters(id) },
  "free-agents": { scope: "league", run: (id) => syncFreeAgents(id) },
  "matchup-sync": { scope: "league", run: syncMatchup },
  values: { scope: "league", run: computeValues },
  schedule: { scope: "shared", run: syncSchedule },
  "box-scores": { scope: "shared", run: () => syncBoxScores() },
  injuries: { scope: "shared", run: syncInjuries },
  projections: { scope: "shared", run: () => computeProjections() },
};

export type JobName = keyof typeof JOBS;

export interface JobRunSummary {
  job: string;
  leagueId: number | null;
  ok: boolean;
  rowsWritten?: number;
  note?: string;
  error?: string;
}

/**
 * Runs a job. League jobs loop over active leagues one at a time (or just
 * `leagueId`), so a failure in one league never blocks the others.
 */
export async function runJob(name: string, leagueId?: number): Promise<JobRunSummary[]> {
  const job = JOBS[name];
  if (!job) throw new Error(`Unknown job ${name}`);
  if (job.scope === "shared") return [await attempt(name, null, () => job.run())];

  const leagueIds = leagueId
    ? [leagueId]
    : (
        await getDb()
          .select({ id: schema.leagues.id })
          .from(schema.leagues)
          .where(and(eq(schema.leagues.isArchived, false)))
      ).map((l) => l.id);
  const out: JobRunSummary[] = [];
  for (const id of leagueIds) out.push(await attempt(name, id, () => job.run(id)));
  return out;
}

async function attempt(job: string, leagueId: number | null, fn: () => Promise<JobResult>): Promise<JobRunSummary> {
  try {
    const r = await runLogged(job, leagueId, fn);
    return { job, leagueId, ok: true, rowsWritten: r.rowsWritten, note: r.note };
  } catch (err) {
    return { job, leagueId, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The Refresh button: one league's Yahoo data, then its values. */
export async function refreshLeague(leagueId: number): Promise<JobRunSummary[]> {
  const out: JobRunSummary[] = [];
  for (const name of ["roster-sync", "free-agents", "matchup-sync", "values"]) {
    out.push(...(await runJob(name, leagueId)));
  }
  return out;
}
