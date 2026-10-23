/**
 * Run a job locally against DATABASE_URL, e.g.:
 *   npm run job -- schedule
 *   npm run job -- roster-sync 3
 * Load env first (e.g. `node --env-file=.env.local` or `vercel env pull`).
 */
import { runJob, JOBS } from "../src/lib/jobs/registry";

const [name, league] = process.argv.slice(2);
if (!name || !JOBS[name]) {
  console.error(`Usage: npm run job -- <${Object.keys(JOBS).join("|")}> [leagueId]`);
  process.exit(1);
}
const runs = await runJob(name, league ? Number(league) : undefined);
console.table(runs);
process.exit(runs.every((r) => r.ok) ? 0 : 1);
