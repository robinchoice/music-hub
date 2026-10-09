CREATE TABLE "open_consents" (
	"track_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "open_consents_track_id_user_id_pk" PRIMARY KEY("track_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "open_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"email" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "open_tracks" (
	"track_id" uuid PRIMARY KEY NOT NULL,
	"version_id" uuid NOT NULL,
	"license" varchar(20) NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"opened_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "stems" ADD COLUMN "forked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "license" varchar(20);--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "forked_from_id" uuid;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "credit" text;--> statement-breakpoint
ALTER TABLE "open_consents" ADD CONSTRAINT "open_consents_track_id_open_tracks_track_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."open_tracks"("track_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_consents" ADD CONSTRAINT "open_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_reports" ADD CONSTRAINT "open_reports_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_tracks" ADD CONSTRAINT "open_tracks_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_tracks" ADD CONSTRAINT "open_tracks_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_tracks" ADD CONSTRAINT "open_tracks_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_forked_from_id_tracks_id_fk" FOREIGN KEY ("forked_from_id") REFERENCES "public"."tracks"("id") ON DELETE set null ON UPDATE no action;