CREATE TABLE "project_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"track_id" uuid,
	"original_file_name" varchar(500) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"file_size" bigint NOT NULL,
	"file_key" text NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by_id" uuid,
	"discarded_at" timestamp,
	CONSTRAINT "project_files_file_key_unique" UNIQUE("file_key"),
	CONSTRAINT "project_file_size_nonnegative" CHECK ("project_files"."file_size" >= 0)
);
--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "stem_mix" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_files_project_id_index" ON "project_files" USING btree ("project_id");