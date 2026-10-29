CREATE INDEX "sessions_user_id_index" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_members_user_id_index" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stem_revisions_stem_id_index" ON "stem_revisions" USING btree ("stem_id");--> statement-breakpoint
CREATE INDEX "stems_track_id_index" ON "stems" USING btree ("track_id");--> statement-breakpoint
CREATE INDEX "tracks_project_id_index" ON "tracks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "versions_track_id_index" ON "versions" USING btree ("track_id");--> statement-breakpoint
CREATE INDEX "comments_version_id_index" ON "comments" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "comments_parent_id_index" ON "comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "listen_events_share_link_id_index" ON "listen_events" USING btree ("share_link_id");--> statement-breakpoint
CREATE INDEX "share_links_version_id_index" ON "share_links" USING btree ("version_id");