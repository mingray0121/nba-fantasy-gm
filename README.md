# nba-fantasy-gm: NBA Fantasy Lineup Assistant

Start / bench / add / drop help for Yahoo Fantasy NBA. One user, many leagues, each league isolated with its own versioned rules. Next.js (TypeScript) on Vercel, Neon Postgres, GitHub Actions for the refresh jobs.

Every recommendation comes from one idea: **a per-player value under that league's scoring, multiplied by the games that player actually has.**

## What's in here

| Path | What it is |
| --- | --- |
| `src/db/schema.ts` | Drizzle schema, 22 tables (21 from the design plus `player_id_overrides`) |
| `drizzle/` | Generated SQL migrations (`npm run db:generate` after schema changes) |
| `src/lib/yahoo/` | OAuth 2.0 (tokens AES-256-GCM encrypted at rest) and a read-only Fantasy API client + JSON parsers |
| `src/lib/nba/` | Schedule and box scores from ESPN's public API (the NBA CDN blocks cloud hosts and non-US networks), balldontlie fallback, behind one `NbaDataSource` interface |
| `src/lib/rules/` | Rule format (JSON and CSV upload), validation, normalization of Yahoo stat names and slots |
| `src/lib/engine/` | Pure logic: projections, points / z-score values, exact lineup optimizer, matchup projection, add/drop pairing |
| `src/lib/data/` | Per-league data loading and the read models behind each page |
| `src/lib/jobs/` | Refresh jobs and the registry the scheduler calls |
| `src/app/` | Pages (Today, Week, Matchup, Add / drop, Rules, Settings, Roster for manual leagues, Player) and API routes |
| `.github/workflows/` | CI plus scheduled jobs that call `/api/jobs/*` |
| `test/` | Unit tests, plus an integration test that runs against a real Postgres |

## How recommendations work

- **Projection per game**: season, last 14 days and last 7 days windows (per-league weights, default 50 / 30 / 20). Per-minute rates and minutes are blended separately, so a minutes jump shows up quickly. Status sets a play probability (Out 0, Doubtful 0.25, GTD / Questionable 0.6, Probable 0.9).
- **League value per game**: points leagues multiply stats by the league's point weights. Category leagues sum z-scores against the league's rostered players; FG% / FT% / 3P% are scored by impact (attempts × difference from the pool percentage), turnovers count negative, punted categories are dropped.
- **Start / bench**: for each day, players with a game fill PG, SG, G, SF, PF, F, C, UTIL to maximize starters first, then total value. Solved exactly (DP over slot bitmasks). IL players stay on IL.
- **Matchup-aware (categories)**: close categories this week weigh 1.5×, likely-decided ones 0.5× when choosing starters. Toggle per league.
- **Add / drop**: a swap is suggested only when a free agent beats your weakest droppable player by your drop margin per game. Rest-of-week gain is shown too.

Both **category (H2H and roto)** and **points** leagues are supported; each league's active rule version decides.

## League rules

Rules import from Yahoo when you connect a league and again every morning; a new version is saved only when something changed. You can also edit them as JSON or upload a file on the Rules page. Each change is a new version for that league only, and you can switch back to any earlier version.

JSON:

```json
{
  "scoring_type": "h2h_categories",
  "categories": ["FG%", "FT%", "3PM", "PTS", "REB", "AST", "STL", "BLK", "TO"],
  "roster_slots": {"PG": 1, "SG": 1, "G": 1, "SF": 1, "PF": 1, "F": 1, "C": 2, "UTIL": 2, "BN": 3, "IL": 2},
  "games_played_limit": null,
  "max_adds_per_week": 4
}
```

A points league uses `"scoring_type": "h2h_points"` and `"point_weights": {"PTS": 1, "REB": 1.2, "AST": 1.5, "STL": 3, "BLK": 3, "TO": -1}` instead of `categories`.

CSV (header `type,key,value`):

```csv
type,key,value
setting,scoring_type,h2h_points
setting,games_played_limit,
setting,max_adds_per_week,4
point,PTS,1
point,TO,-1
slot,UTIL,10
slot,BN,3
```

Stat keys: PTS, REB, OREB, DREB, AST, STL, BLK, TO, 3PM, 3PA, FGM, FGA, FTM, FTA, DD, TD, MIN, FG%, FT%, 3P% (Yahoo names like ST and 3PTM are accepted too).

## Setup

### 1. Yahoo app

Create an app at <https://developer.yahoo.com/apps/create/>:
- API permissions: **Fantasy Sports → Read** (Read/Write later for lineup changes).
- Redirect URI: `https://<your-vercel-domain>/api/auth/yahoo/callback`. Yahoo requires HTTPS, so for local work either use the deployed URL or a tunnel (for example `ngrok http 3000`) and register that URL.

### 2. Vercel + Neon

1. Push this repo to GitHub and import it in Vercel.
2. In the Vercel project: **Storage → Marketplace → Neon**. That adds `DATABASE_URL`.
3. Add the other variables from `.env.example` (`YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, `YAHOO_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY`, `SESSION_SECRET`, `JOB_TOKEN`, optionally `ALLOWED_YAHOO_GUID` and `BALLDONTLIE_API_KEY`).
4. Deploy. `vercel.json` runs `drizzle-kit migrate` before `next build`, so the schema is created on the first deploy.
5. Open the app and sign in with Yahoo. The first account to sign in becomes the owner unless `ALLOWED_YAHOO_GUID` is set; nobody else can sign in afterwards.

### Without Yahoo API access (manual leagues)

Yahoo now approves Fantasy API access per app (apply at <https://sports.yahoo.com/developer/access/>). Until then:

1. Set `APP_PASSWORD` in Vercel (and `.env.local`) and sign in with it. The first Yahoo sign-in later links your Yahoo account to the same owner, so nothing is lost.
2. Create a manual league, then on **Roster** add every team and pick their players. Players come from ESPN (`players` job), with positions and injuries.
3. Players on no team count as free agents, so start / bench and add / drop both work. Re-save a team when its roster changes.

### 3. Scheduled jobs (GitHub Actions)

In the GitHub repo: **Settings → Secrets and variables → Actions**, add:
- `APP_URL`: e.g. `https://your-app.vercel.app`
- `JOB_TOKEN`: same value as in Vercel

Then run **Actions → jobs-nightly → Run workflow** once to load the schedule and box scores. Schedules (UTC, covering US Eastern in both daylight and standard time):

| Workflow | When | Jobs |
| --- | --- | --- |
| `jobs-game-day` | every 15 min, 14:00–04:59 UTC | roster-sync, injuries, values |
| `jobs-hourly` | hourly / every 2 hours | matchup-sync / free-agents, values |
| `jobs-nightly` | 09:00 UTC | box-scores (×3 for catch-up), projections, values |
| `jobs-nightly` | 10:00 UTC | schedule, rules-import, roster-sync, free-agents, values |

League jobs loop through your leagues one at a time, so one failing league never blocks the others. Every run is logged in `sync_runs`. The **Refresh** button in the app runs roster, free agents, matchup and values for just that league.

### Local development

This is a TypeScript / Node.js project, so there is no Python `venv` or Poetry. The npm equivalents:

| Python | This project |
| --- | --- |
| `pyenv` / `.python-version` | `nvm` / `.nvmrc` (Node 22) |
| `venv` | `node_modules/` inside the project folder (created by `npm install`, git-ignored) |
| `pyproject.toml` | `package.json` |
| `poetry.lock` | `package-lock.json` (exact versions; commit it) |
| `poetry install` | `npm ci` |
| `poetry add x` / `poetry add --group dev x` | `npm install x` / `npm install -D x` |
| `poetry run x` | `npm run x` / `npx x` |

Everything installs into the project folder, never globally, so it is already isolated like a venv.

**1. Install Node 22 with nvm** (once per machine):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash   # or: brew install nvm
nvm install        # reads .nvmrc
nvm use
```

**2. Install dependencies** (exact versions from `package-lock.json`):

```bash
npm ci
```

**3. Environment variables.** Copy the template and fill it in. `.env.local` is git-ignored and never leaves your machine:

```bash
cp .env.example .env.local
```

You need a Postgres database for `DATABASE_URL`: a Neon branch (free), or a local one, e.g. `brew install postgresql@16 && createdb nfa` then `DATABASE_URL=postgres://localhost/nfa`. A `localhost` URL uses the node-postgres driver instead of Neon's.

For Yahoo sign-in locally, Yahoo requires an HTTPS redirect: run a tunnel such as `ngrok http 3000`, register `https://<tunnel>/api/auth/yahoo/callback` on your Yahoo app, and put the same URL in `YAHOO_REDIRECT_URI`.

**4. Create the tables, run the app, run jobs:**

```bash
npm run db:migrate              # applies drizzle/ migrations to DATABASE_URL
npm run dev                     # http://localhost:3000
npm run job -- schedule         # load the NBA schedule
npm run job -- box-scores       # box scores (repeat to catch up)
npm run job -- projections
npm run job -- roster-sync 1    # league jobs take a league id
```

**Checks:**

```bash
npm run typecheck
npm test
npm run build
```

### Tests

```bash
npm test                                                            # unit tests
TEST_DATABASE_URL=postgres://postgres@localhost/nfa_test npm test   # plus the integration test (truncates tables!)
```

## Notes and known gaps

- **Not yet tested against live Yahoo or NBA endpoints.** The parsers follow the documented response shapes and have fixture tests, but the first real sync is the real check. If something fails, the error lands in `sync_runs.error` and in the Refresh response.
- Projections are stored as season / last-14 / last-7 windows (`player_projections.horizon`) rather than pre-blended horizons, because the window weights are a per-league setting. Values per horizon (next game, rest of week, rest of season) live in `player_values`.
- Injury status comes from Yahoo player status (collected during roster and free-agent syncs). The official NBA injury report PDF is not parsed.
- Yahoo-to-NBA player matching uses name + team. If a player is mismatched, add a row to `player_id_overrides`.
- Version 1 never writes to Yahoo. Setting lineups and add/drops from the app comes later, behind a confirm step.
