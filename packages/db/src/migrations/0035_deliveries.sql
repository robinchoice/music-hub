CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_link_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_by_id" uuid NOT NULL,
	"client_name" varchar(255) NOT NULL,
	"client_email" varchar(255),
	"reference" varchar(64),
	"included_rounds" integer DEFAULT 2 NOT NULL,
	"extra_round_cents" integer DEFAULT 0 NOT NULL,
	"include_stems" boolean DEFAULT true NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_project_link_id_unique" UNIQUE("project_link_id")
);
--> statement-breakpoint
CREATE TABLE "delivery_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"version_id" uuid,
	"version_number" integer NOT NULL,
	"review_id" uuid,
	"guest_name" varchar(255),
	"extra" boolean NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_rounds_version" UNIQUE("delivery_id","track_id","version_id")
);
--> statement-breakpoint
CREATE TABLE "delivery_tracks" (
	"delivery_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"price_cents" integer NOT NULL,
	"gifted_rounds" integer DEFAULT 0 NOT NULL,
	"approved_version_id" uuid,
	"approved_at" timestamp,
	"approved_by_name" varchar(255),
	CONSTRAINT "delivery_tracks_delivery_id_track_id_pk" PRIMARY KEY("delivery_id","track_id")
);
--> statement-breakpoint
CREATE TABLE "payment_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"nwc_secret_enc" text,
	"nwc_alias" varchar(255),
	"iban" varchar(34),
	"bic" varchar(11),
	"account_holder" varchar(70),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"method" varchar(16) NOT NULL,
	"amount_cents" integer NOT NULL,
	"sats" bigint,
	"invoice" text,
	"payment_hash" varchar(64),
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp,
	"confirmed_by_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan" varchar(16);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan_until" timestamp;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_project_link_id_project_share_links_id_fk" FOREIGN KEY ("project_link_id") REFERENCES "public"."project_share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_rounds" ADD CONSTRAINT "delivery_rounds_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_rounds" ADD CONSTRAINT "delivery_rounds_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_rounds" ADD CONSTRAINT "delivery_rounds_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_rounds" ADD CONSTRAINT "delivery_rounds_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tracks" ADD CONSTRAINT "delivery_tracks_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tracks" ADD CONSTRAINT "delivery_tracks_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tracks" ADD CONSTRAINT "delivery_tracks_approved_version_id_versions_id_fk" FOREIGN KEY ("approved_version_id") REFERENCES "public"."versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_confirmed_by_id_users_id_fk" FOREIGN KEY ("confirmed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_delivery_id_index" ON "payments" USING btree ("delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_open" ON "payments" USING btree ("delivery_id") WHERE status in ('pending', 'announced');