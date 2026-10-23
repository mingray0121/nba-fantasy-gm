ALTER TABLE "player_game_logs" ADD COLUMN "pf" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_game_logs" ADD COLUMN "plus_minus" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_projections" ADD COLUMN "pf" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_projections" ADD COLUMN "plus_minus" real DEFAULT 0 NOT NULL;