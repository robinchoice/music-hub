CREATE TABLE "stems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"original_file_name" varchar(500) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"file_size" bigint NOT NULL,
	"file_key" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stems" ADD CONSTRAINT "stems_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stems" ADD CONSTRAINT "stems_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;