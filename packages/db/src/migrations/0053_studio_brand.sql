ALTER TABLE "users" ADD COLUMN "studio_name" varchar(80);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "studio_line" varchar(120);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "studio_logo_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_studio_name_not_blank" CHECK ("users"."studio_name" is null or btrim("users"."studio_name") <> '');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_studio_line_not_blank" CHECK ("users"."studio_line" is null or btrim("users"."studio_line") <> '');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_studio_logo_key" CHECK ("users"."studio_logo_key" is null or "users"."studio_logo_key" ~ '^covers/[0-9a-f-]{36}\.(jpg|png|webp)$');