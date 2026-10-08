CREATE TABLE "rate_limits" (
	"key" varchar(300) PRIMARY KEY NOT NULL,
	"count" bigint NOT NULL,
	"reset_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audio_jobs" (
	"version_id" uuid PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audio_jobs" ADD CONSTRAINT "audio_jobs_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Versions a restart left unprocessed before jobs were kept in the database
INSERT INTO "audio_jobs" ("version_id") SELECT "id" FROM "versions" WHERE "status" IN ('uploaded', 'processing');
