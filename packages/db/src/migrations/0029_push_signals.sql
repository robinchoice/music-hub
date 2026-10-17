CREATE TABLE "push_notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"track_id" uuid,
	"request_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_notifications_scope" CHECK (("push_notifications"."project_id" is not null) <> ("push_notifications"."request_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "push_notifications" ADD CONSTRAINT "push_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_notifications" ADD CONSTRAINT "push_notifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_notifications" ADD CONSTRAINT "push_notifications_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_notifications" ADD CONSTRAINT "push_notifications_request_id_contact_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."contact_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_notifications_user_cursor_idx" ON "push_notifications" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "push_notifications_created_at_idx" ON "push_notifications" USING btree ("created_at");