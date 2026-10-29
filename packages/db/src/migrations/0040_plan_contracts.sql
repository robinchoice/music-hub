ALTER TABLE "plan_payments" ADD COLUMN "stripe_subscription_id" varchar(255);--> statement-breakpoint
ALTER TABLE "plan_payments" ADD COLUMN "consented_at" timestamp;--> statement-breakpoint
ALTER TABLE "plan_payments" ADD COLUMN "period_start" timestamp;--> statement-breakpoint
ALTER TABLE "plan_payments" ADD COLUMN "confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "plan_payments" ADD COLUMN "withdrawn_at" timestamp;--> statement-breakpoint
ALTER TABLE "plan_payments" ADD COLUMN "refund_cents" integer;