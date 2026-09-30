CREATE TABLE "seed_pairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text NOT NULL,
	"nonce" integer DEFAULT 0 NOT NULL,
	"algorithm" text DEFAULT 'hmac-sha256:v1' NOT NULL,
	"revealed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seed_pairs" ADD CONSTRAINT "seed_pairs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seed_pairs" ADD CONSTRAINT "seed_pairs_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "seed_pairs_active_uq" ON "seed_pairs" USING btree ("user_id","game_id") WHERE "seed_pairs"."revealed_at" is null;--> statement-breakpoint
CREATE INDEX "seed_pairs_user_idx" ON "seed_pairs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "seed_pairs_game_idx" ON "seed_pairs" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_fair_nonce_uq" ON "ledger" USING btree ("user_id","game_id",(meta -> 'fair' ->> 'nonce')) WHERE meta ? 'fair';