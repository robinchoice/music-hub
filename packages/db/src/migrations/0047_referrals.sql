CREATE TABLE "referrals" (
	"referred_id" uuid PRIMARY KEY NOT NULL,
	"referrer_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"rewarded_at" timestamp,
	"referred_rewarded_at" timestamp,
	CONSTRAINT "referrals_not_self" CHECK ("referrals"."referrer_id" <> "referrals"."referred_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referral_code" varchar(16);--> statement-breakpoint
ALTER TABLE "magic_links" ADD COLUMN "referral_code" varchar(16);--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_id_users_id_fk" FOREIGN KEY ("referred_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "referrals_referrer_id_index" ON "referrals" USING btree ("referrer_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code");