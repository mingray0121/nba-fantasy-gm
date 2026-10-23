CREATE TABLE "fantasy_teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"league_id" integer NOT NULL,
	"yahoo_team_key" varchar(64),
	"name" text NOT NULL,
	"manager_name" text,
	"is_mine" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "free_agent_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"league_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"yahoo_rank" integer,
	"percent_owned" real,
	"status" varchar(8) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_roster_slots" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_version_id" integer NOT NULL,
	"slot" varchar(8) NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_rule_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"league_id" integer NOT NULL,
	"version" integer NOT NULL,
	"source" varchar(16) NOT NULL,
	"scoring_type" varchar(20) NOT NULL,
	"games_played_limit" integer,
	"max_adds_per_week" integer,
	"week_start_day" integer DEFAULT 1 NOT NULL,
	"uploaded_file_name" text,
	"rules_raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"league_id" integer NOT NULL,
	"window_weights" jsonb DEFAULT '{"season":0.5,"last14":0.3,"last7":0.2}'::jsonb NOT NULL,
	"punt_categories" text[] DEFAULT '{}' NOT NULL,
	"drop_margin" real DEFAULT 0.5 NOT NULL,
	"matchup_aware" boolean DEFAULT true NOT NULL,
	CONSTRAINT "league_settings_league_id_unique" UNIQUE("league_id")
);
--> statement-breakpoint
CREATE TABLE "league_stat_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_version_id" integer NOT NULL,
	"stat_key" varchar(16) NOT NULL,
	"display_name" text NOT NULL,
	"is_negative" boolean DEFAULT false NOT NULL,
	"point_weight" real,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"source" varchar(16) NOT NULL,
	"yahoo_league_key" varchar(64),
	"season" integer NOT NULL,
	"name" text NOT NULL,
	"num_teams" integer,
	"current_week" integer,
	"active_rule_version_id" integer,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matchups" (
	"id" serial PRIMARY KEY NOT NULL,
	"league_id" integer NOT NULL,
	"week" integer NOT NULL,
	"week_start" date,
	"week_end" date,
	"team_id" integer NOT NULL,
	"opponent_team_id" integer,
	"stats_to_date" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"opponent_stats_to_date" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"points_to_date" real,
	"opponent_points_to_date" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nba_games" (
	"id" serial PRIMARY KEY NOT NULL,
	"nba_game_id" varchar(16) NOT NULL,
	"game_date" date NOT NULL,
	"tip_time" timestamp with time zone,
	"home_team_id" integer NOT NULL,
	"away_team_id" integer NOT NULL,
	"status" varchar(16) NOT NULL,
	"game_type" varchar(16) DEFAULT 'regular' NOT NULL,
	CONSTRAINT "nba_games_nba_game_id_unique" UNIQUE("nba_game_id")
);
--> statement-breakpoint
CREATE TABLE "nba_teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"nba_team_id" integer NOT NULL,
	"abbreviation" varchar(4) NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "nba_teams_nba_team_id_unique" UNIQUE("nba_team_id"),
	CONSTRAINT "nba_teams_abbreviation_unique" UNIQUE("abbreviation")
);
--> statement-breakpoint
CREATE TABLE "player_game_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"game_date" date NOT NULL,
	"minutes" real DEFAULT 0 NOT NULL,
	"pts" integer DEFAULT 0 NOT NULL,
	"reb" integer DEFAULT 0 NOT NULL,
	"oreb" integer DEFAULT 0 NOT NULL,
	"dreb" integer DEFAULT 0 NOT NULL,
	"ast" integer DEFAULT 0 NOT NULL,
	"stl" integer DEFAULT 0 NOT NULL,
	"blk" integer DEFAULT 0 NOT NULL,
	"tov" integer DEFAULT 0 NOT NULL,
	"fgm" integer DEFAULT 0 NOT NULL,
	"fga" integer DEFAULT 0 NOT NULL,
	"ftm" integer DEFAULT 0 NOT NULL,
	"fta" integer DEFAULT 0 NOT NULL,
	"fg3m" integer DEFAULT 0 NOT NULL,
	"fg3a" integer DEFAULT 0 NOT NULL,
	"dnp_reason" text
);
--> statement-breakpoint
CREATE TABLE "player_id_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"yahoo_player_key" varchar(32) NOT NULL,
	"nba_player_id" integer NOT NULL,
	"note" text,
	CONSTRAINT "player_id_overrides_yahoo_player_key_unique" UNIQUE("yahoo_player_key")
);
--> statement-breakpoint
CREATE TABLE "player_injuries" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"status" varchar(16) NOT NULL,
	"note" text,
	"expected_return" date,
	"source" varchar(16) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_injuries_player_id_unique" UNIQUE("player_id")
);
--> statement-breakpoint
CREATE TABLE "player_projections" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"as_of_date" date NOT NULL,
	"horizon" varchar(16) NOT NULL,
	"games_in_window" integer NOT NULL,
	"minutes" real NOT NULL,
	"pts" real NOT NULL,
	"reb" real NOT NULL,
	"oreb" real NOT NULL,
	"dreb" real NOT NULL,
	"ast" real NOT NULL,
	"stl" real NOT NULL,
	"blk" real NOT NULL,
	"tov" real NOT NULL,
	"fgm" real NOT NULL,
	"fga" real NOT NULL,
	"ftm" real NOT NULL,
	"fta" real NOT NULL,
	"fg3m" real NOT NULL,
	"fg3a" real NOT NULL,
	"dd" real DEFAULT 0 NOT NULL,
	"td" real DEFAULT 0 NOT NULL,
	"games_remaining" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_values" (
	"id" serial PRIMARY KEY NOT NULL,
	"league_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"as_of_date" date NOT NULL,
	"horizon" varchar(16) NOT NULL,
	"value_per_game" real NOT NULL,
	"category_z" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"games" integer DEFAULT 0 NOT NULL,
	"total_value" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"nba_player_id" integer,
	"yahoo_player_key" varchar(32),
	"full_name" text NOT NULL,
	"nba_team_id" integer,
	"eligible_positions" text[] DEFAULT '{}' NOT NULL,
	"yahoo_status" varchar(16),
	"headshot_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_nba_player_id_unique" UNIQUE("nba_player_id"),
	CONSTRAINT "players_yahoo_player_key_unique" UNIQUE("yahoo_player_key")
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" serial PRIMARY KEY NOT NULL,
	"league_id" integer NOT NULL,
	"fantasy_team_id" integer NOT NULL,
	"for_date" date NOT NULL,
	"type" varchar(8) NOT NULL,
	"player_id" integer NOT NULL,
	"paired_player_id" integer,
	"slot" varchar(8),
	"score_delta" real,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roster_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"league_id" integer NOT NULL,
	"fantasy_team_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"date" date NOT NULL,
	"slot" varchar(8) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_name" varchar(32) NOT NULL,
	"league_id" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" varchar(12) NOT NULL,
	"rows_written" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"league_id" integer NOT NULL,
	"yahoo_transaction_key" varchar(64) NOT NULL,
	"type" varchar(16) NOT NULL,
	"player_id" integer NOT NULL,
	"team_id" integer,
	"happened_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"yahoo_guid" varchar(64) NOT NULL,
	"email" text,
	"display_name" text,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_yahoo_guid_unique" UNIQUE("yahoo_guid")
);
--> statement-breakpoint
CREATE TABLE "yahoo_tokens" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fantasy_teams" ADD CONSTRAINT "fantasy_teams_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_agent_snapshots" ADD CONSTRAINT "free_agent_snapshots_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_agent_snapshots" ADD CONSTRAINT "free_agent_snapshots_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_roster_slots" ADD CONSTRAINT "league_roster_slots_rule_version_id_league_rule_versions_id_fk" FOREIGN KEY ("rule_version_id") REFERENCES "public"."league_rule_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_rule_versions" ADD CONSTRAINT "league_rule_versions_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_settings" ADD CONSTRAINT "league_settings_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_stat_categories" ADD CONSTRAINT "league_stat_categories_rule_version_id_league_rule_versions_id_fk" FOREIGN KEY ("rule_version_id") REFERENCES "public"."league_rule_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_active_rule_version_id_league_rule_versions_id_fk" FOREIGN KEY ("active_rule_version_id") REFERENCES "public"."league_rule_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchups" ADD CONSTRAINT "matchups_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchups" ADD CONSTRAINT "matchups_team_id_fantasy_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."fantasy_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchups" ADD CONSTRAINT "matchups_opponent_team_id_fantasy_teams_id_fk" FOREIGN KEY ("opponent_team_id") REFERENCES "public"."fantasy_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nba_games" ADD CONSTRAINT "nba_games_home_team_id_nba_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."nba_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nba_games" ADD CONSTRAINT "nba_games_away_team_id_nba_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."nba_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_game_logs" ADD CONSTRAINT "player_game_logs_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_game_logs" ADD CONSTRAINT "player_game_logs_game_id_nba_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."nba_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_injuries" ADD CONSTRAINT "player_injuries_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_projections" ADD CONSTRAINT "player_projections_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_values" ADD CONSTRAINT "player_values_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_values" ADD CONSTRAINT "player_values_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_nba_team_id_nba_teams_id_fk" FOREIGN KEY ("nba_team_id") REFERENCES "public"."nba_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_fantasy_team_id_fantasy_teams_id_fk" FOREIGN KEY ("fantasy_team_id") REFERENCES "public"."fantasy_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_paired_player_id_players_id_fk" FOREIGN KEY ("paired_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_fantasy_team_id_fantasy_teams_id_fk" FOREIGN KEY ("fantasy_team_id") REFERENCES "public"."fantasy_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_team_id_fantasy_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."fantasy_teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yahoo_tokens" ADD CONSTRAINT "yahoo_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fantasy_teams_league_key" ON "fantasy_teams" USING btree ("league_id","yahoo_team_key");--> statement-breakpoint
CREATE INDEX "free_agent_snapshots_league_taken" ON "free_agent_snapshots" USING btree ("league_id","taken_at");--> statement-breakpoint
CREATE UNIQUE INDEX "league_roster_slots_version_slot" ON "league_roster_slots" USING btree ("rule_version_id","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "league_rule_versions_league_version" ON "league_rule_versions" USING btree ("league_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "league_stat_categories_version_key" ON "league_stat_categories" USING btree ("rule_version_id","stat_key");--> statement-breakpoint
CREATE UNIQUE INDEX "leagues_user_yahoo_key" ON "leagues" USING btree ("user_id","yahoo_league_key");--> statement-breakpoint
CREATE UNIQUE INDEX "matchups_league_week_team" ON "matchups" USING btree ("league_id","week","team_id");--> statement-breakpoint
CREATE INDEX "nba_games_game_date" ON "nba_games" USING btree ("game_date");--> statement-breakpoint
CREATE UNIQUE INDEX "player_game_logs_player_game" ON "player_game_logs" USING btree ("player_id","game_id");--> statement-breakpoint
CREATE INDEX "player_game_logs_player_date" ON "player_game_logs" USING btree ("player_id","game_date");--> statement-breakpoint
CREATE UNIQUE INDEX "player_projections_player_date_horizon" ON "player_projections" USING btree ("player_id","as_of_date","horizon");--> statement-breakpoint
CREATE UNIQUE INDEX "player_values_league_player_date_horizon" ON "player_values" USING btree ("league_id","player_id","as_of_date","horizon");--> statement-breakpoint
CREATE INDEX "player_values_league_date_horizon" ON "player_values" USING btree ("league_id","as_of_date","horizon");--> statement-breakpoint
CREATE INDEX "players_full_name" ON "players" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "recommendations_league_date" ON "recommendations" USING btree ("league_id","for_date");--> statement-breakpoint
CREATE UNIQUE INDEX "roster_entries_team_date_player" ON "roster_entries" USING btree ("fantasy_team_id","date","player_id");--> statement-breakpoint
CREATE INDEX "roster_entries_team_date" ON "roster_entries" USING btree ("fantasy_team_id","date");--> statement-breakpoint
CREATE INDEX "roster_entries_league_date" ON "roster_entries" USING btree ("league_id","date");--> statement-breakpoint
CREATE INDEX "sync_runs_job_started" ON "sync_runs" USING btree ("job_name","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_league_key_player" ON "transactions" USING btree ("league_id","yahoo_transaction_key","player_id");