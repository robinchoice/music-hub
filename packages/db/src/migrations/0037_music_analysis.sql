ALTER TABLE "versions" ADD COLUMN "bpm" real;--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "key_root" varchar(2);--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "key_scale" varchar(5);--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "analyzed_at" timestamp;