CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"token" varchar(64) NOT NULL,
	"created_by_id" uuid NOT NULL,
	"expires_at" timestamp,
	"allow_comments" boolean DEFAULT true NOT NULL,
	"allow_download" boolean DEFAULT false NOT NULL,
	"password_hash" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "share_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "versions" DROP CONSTRAINT "versions_track_id_version_number_unique";--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "parent_version_id" uuid;--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "branch_label" varchar(100);--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "guest_name" varchar(100);--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_parent_version_id_versions_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."versions"("id") ON DELETE set null ON UPDATE no action;