CREATE TABLE "project_share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"token" varchar(64) NOT NULL,
	"created_by_id" uuid NOT NULL,
	"expires_at" timestamp,
	"allow_comments" boolean DEFAULT true NOT NULL,
	"allow_download" boolean DEFAULT false NOT NULL,
	"password_hash" varchar(255),
	"follows" varchar(16) DEFAULT 'latest' NOT NULL,
	"track_ids" uuid[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_share_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "project_link_id" uuid;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "track_id" uuid;--> statement-breakpoint
ALTER TABLE "project_share_links" ADD CONSTRAINT "project_share_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_share_links" ADD CONSTRAINT "project_share_links_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_project_link_id_project_share_links_id_fk" FOREIGN KEY ("project_link_id") REFERENCES "public"."project_share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_project_link_track" UNIQUE("project_link_id","track_id");