import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

export interface JobResult {
  rowsWritten: number;
  note?: string;
}

/** Runs a job and records it in sync_runs. Errors are logged and rethrown. */
export async function runLogged(
  jobName: string,
  leagueId: number | null,
  fn: () => Promise<JobResult>,
): Promise<JobResult> {
  const db = getDb();
  const [run] = await db
    .insert(schema.syncRuns)
    .values({ jobName, leagueId, status: "running" })
    .returning({ id: schema.syncRuns.id });
  try {
    const result = await fn();
    await db
      .update(schema.syncRuns)
      .set({ status: "ok", finishedAt: new Date(), rowsWritten: result.rowsWritten, error: result.note ?? null })
      .where(eq(schema.syncRuns.id, run.id));
    return result;
  } catch (err) {
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    await db
      .update(schema.syncRuns)
      .set({ status: "error", finishedAt: new Date(), error: message.slice(0, 4000) })
      .where(eq(schema.syncRuns.id, run.id));
    throw err;
  }
}

/** Splits an array into chunks (keeps inserts under Postgres parameter limits). */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
