ALTER TABLE "games" ADD COLUMN "moderation_note" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "games_status_changed_idx" ON "games" USING btree ("status","status_changed_at");--> statement-breakpoint
CREATE INDEX "games_categories_idx" ON "games" USING gin ("categories");--> statement-breakpoint
CREATE INDEX "ledger_game_idx" ON "ledger" USING btree ("game_id");