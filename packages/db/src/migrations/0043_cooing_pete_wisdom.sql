CREATE TABLE "stem_mix_jobs" (
	"track_id" uuid PRIMARY KEY NOT NULL,
	"revision" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_by_id" uuid NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"locked_until" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "stem_mix_attempts_nonnegative" CHECK ("stem_mix_jobs"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "auto_mix" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stem_mix_jobs" ADD CONSTRAINT "stem_mix_jobs_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stem_mix_jobs" ADD CONSTRAINT "stem_mix_jobs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;