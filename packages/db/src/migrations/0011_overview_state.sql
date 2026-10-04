CREATE TABLE "task_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"task_key" varchar(200) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "task_dismissals_user_id_task_key_unique" UNIQUE("user_id","task_key")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tracks_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "decided_by_id" uuid;--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "decided_at" timestamp;--> statement-breakpoint
ALTER TABLE "task_dismissals" ADD CONSTRAINT "task_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;