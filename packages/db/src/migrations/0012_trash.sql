ALTER TABLE "stems" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "stems" ADD COLUMN "deleted_by_id" uuid;--> statement-breakpoint
ALTER TABLE "stems" ADD COLUMN "discarded_at" timestamp;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "deleted_by_id" uuid;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "discarded_at" timestamp;--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "deleted_by_id" uuid;--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "discarded_at" timestamp;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "deleted_by_id" uuid;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "discarded_at" timestamp;--> statement-breakpoint
ALTER TABLE "stems" ADD CONSTRAINT "stems_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;