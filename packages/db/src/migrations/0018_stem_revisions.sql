CREATE TABLE "stem_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stem_id" uuid NOT NULL,
	"original_file_name" varchar(500) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"file_size" bigint NOT NULL,
	"file_key" text NOT NULL,
	"forked" boolean DEFAULT false NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp NOT NULL,
	"replaced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stems" ADD COLUMN "revised_at" timestamp;--> statement-breakpoint
ALTER TABLE "stem_revisions" ADD CONSTRAINT "stem_revisions_stem_id_stems_id_fk" FOREIGN KEY ("stem_id") REFERENCES "public"."stems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stem_revisions" ADD CONSTRAINT "stem_revisions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;