CREATE TABLE "dropbox_connections" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"account_id" varchar(100) NOT NULL,
	"display_name" varchar(255),
	"root_namespace_id" varchar(40),
	"refresh_token_enc" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"entry" integer NOT NULL,
	"position" integer NOT NULL,
	"kind" varchar(10) NOT NULL,
	"name" varchar(255) NOT NULL,
	"project_id" uuid NOT NULL,
	"track_id" uuid,
	"file_name" varchar(255) NOT NULL,
	"rev" varchar(64) NOT NULL,
	"file_size" bigint NOT NULL,
	"content_hash" varchar(64),
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"leased_until" timestamp,
	"error" text,
	"finished_at" timestamp,
	CONSTRAINT "import_item_kind" CHECK ("import_items"."kind" in ('version', 'stem', 'file')),
	CONSTRAINT "import_item_status" CHECK ("import_items"."status" in ('pending', 'done', 'failed')),
	CONSTRAINT "import_item_attempts_nonnegative" CHECK ("import_items"."attempts" >= 0),
	CONSTRAINT "import_item_size_nonnegative" CHECK ("import_items"."file_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" varchar(20) DEFAULT 'dropbox' NOT NULL,
	"root_path" text NOT NULL,
	"entries" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'scanned' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	CONSTRAINT "import_status" CHECK ("imports"."status" in ('scanned', 'running', 'done', 'cancelled')),
	CONSTRAINT "import_source" CHECK ("imports"."source" in ('dropbox'))
);
--> statement-breakpoint
ALTER TABLE "dropbox_connections" ADD CONSTRAINT "dropbox_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_items_import_id_position_index" ON "import_items" USING btree ("import_id","position");--> statement-breakpoint
CREATE INDEX "import_items_status_index" ON "import_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "imports_user_id_index" ON "imports" USING btree ("user_id");