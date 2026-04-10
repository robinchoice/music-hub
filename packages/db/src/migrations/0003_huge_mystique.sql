CREATE TYPE "public"."track_status" AS ENUM('sketch', 'in_progress', 'final', 'released');--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "status" "track_status" DEFAULT 'in_progress' NOT NULL;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "section" varchar(100);