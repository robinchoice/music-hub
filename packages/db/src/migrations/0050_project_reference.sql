ALTER TABLE "project_files" ADD COLUMN "reference" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_files" ADD COLUMN "measurements" jsonb;--> statement-breakpoint
ALTER TABLE "project_files" ADD COLUMN "integrated_lufs" real;--> statement-breakpoint
ALTER TABLE "project_files" ADD COLUMN "measured_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "project_files_one_reference" ON "project_files" USING btree ("project_id") WHERE "project_files"."reference";