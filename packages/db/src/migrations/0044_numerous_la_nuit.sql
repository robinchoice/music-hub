CREATE TABLE "stem_mix_uploads" (
	"file_key" text PRIMARY KEY NOT NULL,
	"track_id" uuid NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stem_mix_uploads" ADD CONSTRAINT "stem_mix_uploads_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stem_mix_uploads_expires_at_index" ON "stem_mix_uploads" USING btree ("expires_at");