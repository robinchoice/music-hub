CREATE TABLE "listen_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_link_id" uuid NOT NULL,
	"listener_name" varchar(255),
	"ip_hash" varchar(64),
	"user_agent" varchar(500),
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"first_play_at" timestamp,
	"listen_seconds" integer DEFAULT 0 NOT NULL,
	"completed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listen_events" ADD CONSTRAINT "listen_events_share_link_id_share_links_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_links"("id") ON DELETE cascade ON UPDATE no action;
