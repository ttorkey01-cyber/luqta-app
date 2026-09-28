CREATE TABLE "hunt_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"access_token_hash" text NOT NULL,
	"platform" text NOT NULL,
	"expo_push_token" text,
	"push_notifications_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hunt_devices_access_token_hash_unique" UNIQUE("access_token_hash"),
	CONSTRAINT "hunt_devices_expo_push_token_unique" UNIQUE("expo_push_token")
);
--> statement-breakpoint
CREATE TABLE "saved_hunts" (
	"id" text NOT NULL,
	"device_id" uuid NOT NULL,
	"query" text NOT NULL,
	"original_query" text NOT NULL,
	"normalized_intent" text NOT NULL,
	"structured_intent" jsonb NOT NULL,
	"target_price" numeric(12, 2),
	"currency" text DEFAULT 'SAR' NOT NULL,
	"condition" text DEFAULT 'any' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"match_status" text,
	"best_match_id" text,
	"best_match_title" text,
	"best_price" numeric(12, 2),
	"discovery_matches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_hunts_device_id_id_pk" PRIMARY KEY("device_id","id")
);
--> statement-breakpoint
CREATE TABLE "hunt_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"hunt_id" text NOT NULL,
	"result_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"price" numeric(12, 2),
	"currency" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expo_ticket_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hunt_search_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"results" jsonb NOT NULL,
	"provider_ids" text[] DEFAULT '{}' NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hunt_monitor_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text NOT NULL,
	"active_hunt_count" integer DEFAULT 0 NOT NULL,
	"unique_query_count" integer DEFAULT 0 NOT NULL,
	"policy_skipped_count" integer DEFAULT 0 NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"notification_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "saved_hunts" ADD CONSTRAINT "saved_hunts_device_id_hunt_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."hunt_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hunt_notifications" ADD CONSTRAINT "hunt_notifications_saved_hunt_fk" FOREIGN KEY ("device_id","hunt_id") REFERENCES "public"."saved_hunts"("device_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_hunts_active_idx" ON "saved_hunts" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "saved_hunts_device_created_idx" ON "saved_hunts" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hunt_notifications_dedupe_idx" ON "hunt_notifications" USING btree ("device_id","hunt_id","result_key");--> statement-breakpoint
CREATE INDEX "hunt_notifications_pending_idx" ON "hunt_notifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "hunt_search_cache_expiry_idx" ON "hunt_search_cache" USING btree ("expires_at");