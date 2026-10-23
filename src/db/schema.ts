import {
  pgTable,
  serial,
  integer,
  text,
  varchar,
  boolean,
  timestamp,
  date,
  real,
  jsonb,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* You (single user)                                                   */
/* ------------------------------------------------------------------ */

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  yahooGuid: varchar("yahoo_guid", { length: 64 }).notNull().unique(),
  email: text("email"),
  displayName: text("display_name"),
  timezone: text("timezone").notNull().default("America/New_York"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const yahooTokens = pgTable("yahoo_tokens", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token").notNull(), // AES-256-GCM, see lib/crypto.ts
  refreshToken: text("refresh_token").notNull(), // AES-256-GCM
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Your leagues (everything keyed by league_id)                        */
/* ------------------------------------------------------------------ */

export const leagues = pgTable(
  "leagues",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 16 }).$type<"yahoo" | "manual">().notNull(),
    yahooLeagueKey: varchar("yahoo_league_key", { length: 64 }),
    season: integer("season").notNull(),
    name: text("name").notNull(),
    numTeams: integer("num_teams"),
    currentWeek: integer("current_week"),
    activeRuleVersionId: integer("active_rule_version_id").references(
      (): AnyPgColumn => leagueRuleVersions.id,
      { onDelete: "set null" },
    ),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("leagues_user_yahoo_key").on(t.userId, t.yahooLeagueKey)],
);

export type ScoringType = "h2h_categories" | "h2h_points" | "roto";
export type RuleSource = "yahoo_import" | "manual_edit" | "file_upload";

export const leagueRuleVersions = pgTable(
  "league_rule_versions",
  {
    id: serial("id").primaryKey(),
    leagueId: integer("league_id")
      .notNull()
      .references((): AnyPgColumn => leagues.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    source: varchar("source", { length: 16 }).$type<RuleSource>().notNull(),
    scoringType: varchar("scoring_type", { length: 20 }).$type<ScoringType>().notNull(),
    gamesPlayedLimit: integer("games_played_limit"),
    maxAddsPerWeek: integer("max_adds_per_week"),
    weekStartDay: integer("week_start_day").notNull().default(1), // 0 = Sunday, 1 = Monday
    uploadedFileName: text("uploaded_file_name"),
    rulesRaw: jsonb("rules_raw").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("league_rule_versions_league_version").on(t.leagueId, t.version)],
);

export const leagueStatCategories = pgTable(
  "league_stat_categories",
  {
    id: serial("id").primaryKey(),
    ruleVersionId: integer("rule_version_id")
      .notNull()
      .references(() => leagueRuleVersions.id, { onDelete: "cascade" }),
    statKey: varchar("stat_key", { length: 16 }).notNull(),
    displayName: text("display_name").notNull(),
    isNegative: boolean("is_negative").notNull().default(false),
    pointWeight: real("point_weight"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("league_stat_categories_version_key").on(t.ruleVersionId, t.statKey)],
);

export const leagueRosterSlots = pgTable(
  "league_roster_slots",
  {
    id: serial("id").primaryKey(),
    ruleVersionId: integer("rule_version_id")
      .notNull()
      .references(() => leagueRuleVersions.id, { onDelete: "cascade" }),
    slot: varchar("slot", { length: 8 }).notNull(),
    count: integer("count").notNull(),
  },
  (t) => [uniqueIndex("league_roster_slots_version_slot").on(t.ruleVersionId, t.slot)],
);

export const leagueSettings = pgTable("league_settings", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id")
    .notNull()
    .unique()
    .references(() => leagues.id, { onDelete: "cascade" }),
  windowWeights: jsonb("window_weights")
    .$type<{ season: number; last14: number; last7: number }>()
    .notNull()
    .default({ season: 0.5, last14: 0.3, last7: 0.2 }),
  puntCategories: text("punt_categories").array().notNull().default([]),
  dropMargin: real("drop_margin").notNull().default(0.5),
  matchupAware: boolean("matchup_aware").notNull().default(true),
});

export const fantasyTeams = pgTable(
  "fantasy_teams",
  {
    id: serial("id").primaryKey(),
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    yahooTeamKey: varchar("yahoo_team_key", { length: 64 }),
    name: text("name").notNull(),
    managerName: text("manager_name"),
    isMine: boolean("is_mine").notNull().default(false),
  },
  (t) => [uniqueIndex("fantasy_teams_league_key").on(t.leagueId, t.yahooTeamKey)],
);

export const rosterEntries = pgTable(
  "roster_entries",
  {
    id: serial("id").primaryKey(),
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    fantasyTeamId: integer("fantasy_team_id")
      .notNull()
      .references(() => fantasyTeams.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    date: date("date").notNull(),
    slot: varchar("slot", { length: 8 }).notNull(),
  },
  (t) => [
    uniqueIndex("roster_entries_team_date_player").on(t.fantasyTeamId, t.date, t.playerId),
    index("roster_entries_team_date").on(t.fantasyTeamId, t.date),
    index("roster_entries_league_date").on(t.leagueId, t.date),
  ],
);

export const freeAgentSnapshots = pgTable(
  "free_agent_snapshots",
  {
    id: serial("id").primaryKey(),
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
    yahooRank: integer("yahoo_rank"),
    percentOwned: real("percent_owned"),
    status: varchar("status", { length: 8 }).$type<"FA" | "W">().notNull(),
  },
  (t) => [index("free_agent_snapshots_league_taken").on(t.leagueId, t.takenAt)],
);

export const matchups = pgTable(
  "matchups",
  {
    id: serial("id").primaryKey(),
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    week: integer("week").notNull(),
    weekStart: date("week_start"),
    weekEnd: date("week_end"),
    teamId: integer("team_id")
      .notNull()
      .references(() => fantasyTeams.id, { onDelete: "cascade" }),
    opponentTeamId: integer("opponent_team_id").references(() => fantasyTeams.id, {
      onDelete: "cascade",
    }),
    statsToDate: jsonb("stats_to_date").$type<Record<string, number>>().notNull().default({}),
    opponentStatsToDate: jsonb("opponent_stats_to_date")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    pointsToDate: real("points_to_date"),
    opponentPointsToDate: real("opponent_points_to_date"),
    // Manual leagues: statsToDate covers games through this date; later days are added from box scores.
    baselineThrough: date("baseline_through"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("matchups_league_week_team").on(t.leagueId, t.week, t.teamId)],
);

export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    yahooTransactionKey: varchar("yahoo_transaction_key", { length: 64 }).notNull(),
    type: varchar("type", { length: 16 }).$type<"add" | "drop" | "trade">().notNull(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    teamId: integer("team_id").references(() => fantasyTeams.id, { onDelete: "set null" }),
    happenedAt: timestamp("happened_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("transactions_league_key_player").on(
      t.leagueId,
      t.yahooTransactionKey,
      t.playerId,
    ),
  ],
);

/* ------------------------------------------------------------------ */
/* NBA facts (shared across leagues)                                   */
/* ------------------------------------------------------------------ */

export const nbaTeams = pgTable("nba_teams", {
  id: serial("id").primaryKey(),
  nbaTeamId: integer("nba_team_id").notNull().unique(),
  abbreviation: varchar("abbreviation", { length: 4 }).notNull().unique(),
  name: text("name").notNull(),
});

export const players = pgTable(
  "players",
  {
    id: serial("id").primaryKey(),
    nbaPlayerId: integer("nba_player_id").unique(),
    yahooPlayerKey: varchar("yahoo_player_key", { length: 32 }).unique(),
    fullName: text("full_name").notNull(),
    nbaTeamId: integer("nba_team_id").references(() => nbaTeams.id),
    eligiblePositions: text("eligible_positions").array().notNull().default([]),
    yahooStatus: varchar("yahoo_status", { length: 16 }),
    headshotUrl: text("headshot_url"),
    isActive: boolean("is_active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("players_full_name").on(t.fullName)],
);

/** Manual Yahoo-to-NBA links for players automatic name matching misses. */
export const playerIdOverrides = pgTable("player_id_overrides", {
  id: serial("id").primaryKey(),
  yahooPlayerKey: varchar("yahoo_player_key", { length: 32 }).notNull().unique(),
  nbaPlayerId: integer("nba_player_id").notNull(),
  note: text("note"),
});

export const nbaGames = pgTable(
  "nba_games",
  {
    id: serial("id").primaryKey(),
    nbaGameId: varchar("nba_game_id", { length: 16 }).notNull().unique(),
    gameDate: date("game_date").notNull(), // US Eastern calendar date
    tipTime: timestamp("tip_time", { withTimezone: true }),
    homeTeamId: integer("home_team_id")
      .notNull()
      .references(() => nbaTeams.id),
    awayTeamId: integer("away_team_id")
      .notNull()
      .references(() => nbaTeams.id),
    status: varchar("status", { length: 16 }).$type<"scheduled" | "live" | "final">().notNull(),
    gameType: varchar("game_type", { length: 16 }).notNull().default("regular"),
  },
  (t) => [index("nba_games_game_date").on(t.gameDate)],
);

export const playerGameLogs = pgTable(
  "player_game_logs",
  {
    id: serial("id").primaryKey(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    gameId: integer("game_id")
      .notNull()
      .references(() => nbaGames.id),
    gameDate: date("game_date").notNull(),
    minutes: real("minutes").notNull().default(0),
    pts: integer("pts").notNull().default(0),
    reb: integer("reb").notNull().default(0),
    oreb: integer("oreb").notNull().default(0),
    dreb: integer("dreb").notNull().default(0),
    ast: integer("ast").notNull().default(0),
    stl: integer("stl").notNull().default(0),
    blk: integer("blk").notNull().default(0),
    tov: integer("tov").notNull().default(0),
    fgm: integer("fgm").notNull().default(0),
    fga: integer("fga").notNull().default(0),
    ftm: integer("ftm").notNull().default(0),
    fta: integer("fta").notNull().default(0),
    fg3m: integer("fg3m").notNull().default(0),
    fg3a: integer("fg3a").notNull().default(0),
    pf: integer("pf").notNull().default(0),
    plusMinus: integer("plus_minus").notNull().default(0),
    dnpReason: text("dnp_reason"),
  },
  (t) => [
    uniqueIndex("player_game_logs_player_game").on(t.playerId, t.gameId),
    index("player_game_logs_player_date").on(t.playerId, t.gameDate),
  ],
);

export type InjuryStatus = "Out" | "Doubtful" | "Questionable" | "Probable" | "GTD" | "DTD";

export const playerInjuries = pgTable("player_injuries", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id")
    .notNull()
    .unique()
    .references(() => players.id),
  status: varchar("status", { length: 16 }).$type<InjuryStatus>().notNull(),
  note: text("note"),
  expectedReturn: date("expected_return"),
  source: varchar("source", { length: 16 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Model outputs                                                       */
/* ------------------------------------------------------------------ */

/**
 * Per-game stat lines, shared by every league. Each player gets one row per
 * window (season / last14 / last7); leagues blend the windows with their own
 * window weights when computing values (see lib/engine/projections.ts).
 */
export type ProjectionHorizon = "season" | "last14" | "last7";

export const playerProjections = pgTable(
  "player_projections",
  {
    id: serial("id").primaryKey(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    asOfDate: date("as_of_date").notNull(),
    horizon: varchar("horizon", { length: 16 }).$type<ProjectionHorizon>().notNull(),
    gamesInWindow: integer("games_in_window").notNull(),
    minutes: real("minutes").notNull(),
    pts: real("pts").notNull(),
    reb: real("reb").notNull(),
    oreb: real("oreb").notNull(),
    dreb: real("dreb").notNull(),
    ast: real("ast").notNull(),
    stl: real("stl").notNull(),
    blk: real("blk").notNull(),
    tov: real("tov").notNull(),
    fgm: real("fgm").notNull(),
    fga: real("fga").notNull(),
    ftm: real("ftm").notNull(),
    fta: real("fta").notNull(),
    fg3m: real("fg3m").notNull(),
    fg3a: real("fg3a").notNull(),
    dd: real("dd").notNull().default(0), // double-double rate per game
    td: real("td").notNull().default(0), // triple-double rate per game
    pf: real("pf").notNull().default(0),
    plusMinus: real("plus_minus").notNull().default(0),
    gamesRemaining: integer("games_remaining").notNull().default(0), // rest of season
  },
  (t) => [uniqueIndex("player_projections_player_date_horizon").on(t.playerId, t.asOfDate, t.horizon)],
);

export type ValueHorizon = "next_game" | "rest_of_week" | "rest_of_season";

export const playerValues = pgTable(
  "player_values",
  {
    id: serial("id").primaryKey(),
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    asOfDate: date("as_of_date").notNull(),
    horizon: varchar("horizon", { length: 16 }).$type<ValueHorizon>().notNull(),
    valuePerGame: real("value_per_game").notNull(),
    categoryZ: jsonb("category_z").$type<Record<string, number>>().notNull().default({}),
    games: integer("games").notNull().default(0),
    totalValue: real("total_value").notNull(),
  },
  (t) => [
    uniqueIndex("player_values_league_player_date_horizon").on(
      t.leagueId,
      t.playerId,
      t.asOfDate,
      t.horizon,
    ),
    index("player_values_league_date_horizon").on(t.leagueId, t.asOfDate, t.horizon),
  ],
);

export type RecommendationType = "start" | "bench" | "add" | "drop";

export const recommendations = pgTable(
  "recommendations",
  {
    id: serial("id").primaryKey(),
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    fantasyTeamId: integer("fantasy_team_id")
      .notNull()
      .references(() => fantasyTeams.id, { onDelete: "cascade" }),
    forDate: date("for_date").notNull(),
    type: varchar("type", { length: 8 }).$type<RecommendationType>().notNull(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    pairedPlayerId: integer("paired_player_id").references(() => players.id),
    slot: varchar("slot", { length: 8 }),
    scoreDelta: real("score_delta"),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("recommendations_league_date").on(t.leagueId, t.forDate)],
);

/* ------------------------------------------------------------------ */
/* Job logs                                                            */
/* ------------------------------------------------------------------ */

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: serial("id").primaryKey(),
    jobName: varchar("job_name", { length: 32 }).notNull(),
    leagueId: integer("league_id").references(() => leagues.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: varchar("status", { length: 12 }).$type<"running" | "ok" | "error">().notNull(),
    rowsWritten: integer("rows_written").notNull().default(0),
    error: text("error"),
  },
  (t) => [index("sync_runs_job_started").on(t.jobName, t.startedAt)],
);
