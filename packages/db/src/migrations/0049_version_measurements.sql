ALTER TABLE "versions" ADD COLUMN "measurements" jsonb;--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "measured_at" timestamp;