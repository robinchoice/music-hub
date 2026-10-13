CREATE TABLE "guest_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track_id" uuid NOT NULL,
	"guest_name" varchar(100) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "guest_uploads" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "guest_storage_limit" bigint;--> statement-breakpoint
ALTER TABLE "stem_revisions" ADD COLUMN "guest_name" varchar(100);--> statement-breakpoint
ALTER TABLE "guest_notes" ADD CONSTRAINT "guest_notes_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;