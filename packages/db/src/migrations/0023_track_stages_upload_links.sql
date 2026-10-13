ALTER TYPE "public"."track_status" ADD VALUE 'recording' BEFORE 'final';--> statement-breakpoint
ALTER TYPE "public"."track_status" ADD VALUE 'mixing' BEFORE 'final';--> statement-breakpoint
ALTER TYPE "public"."track_status" ADD VALUE 'mastering' BEFORE 'final';--> statement-breakpoint
CREATE TABLE "upload_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"token" varchar(64) NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "upload_links_project_id_unique" UNIQUE("project_id"),
	CONSTRAINT "upload_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "tracks" ALTER COLUMN "status" SET DEFAULT 'sketch';--> statement-breakpoint
ALTER TABLE "stems" ADD COLUMN "guest_name" varchar(100);--> statement-breakpoint
ALTER TABLE "upload_links" ADD CONSTRAINT "upload_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_links" ADD CONSTRAINT "upload_links_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;