ALTER TABLE "versions" ADD COLUMN "sample_format" varchar(16);--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "loudness_range" real;--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "true_peak" real;