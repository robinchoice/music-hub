CREATE TABLE "version_notices" (
	"version_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "version_mails" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mail_token" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "stem_revisions" ADD COLUMN "sha256" varchar(64);--> statement-breakpoint
ALTER TABLE "stems" ADD COLUMN "sha256" varchar(64);--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "sha256" varchar(64);--> statement-breakpoint
ALTER TABLE "version_notices" ADD CONSTRAINT "version_notices_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_notices" ADD CONSTRAINT "version_notices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_notices" ADD CONSTRAINT "version_notices_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "version_notices_project_id_actor_id_index" ON "version_notices" USING btree ("project_id","actor_id");