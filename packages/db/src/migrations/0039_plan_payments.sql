CREATE TABLE "plan_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"provider" varchar(16) NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"plan" varchar(16) NOT NULL,
	"period" varchar(8) NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"checkout_url" text,
	"paid_until" timestamp,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plan_payments_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_customer_id" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_subscription_id" varchar(255);--> statement-breakpoint
ALTER TABLE "plan_payments" ADD CONSTRAINT "plan_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_payments_user_idx" ON "plan_payments" USING btree ("user_id");