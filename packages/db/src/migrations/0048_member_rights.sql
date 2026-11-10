ALTER TABLE "project_members" ADD COLUMN "can_download" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_members" ADD COLUMN "can_invite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Preset from the roles, as rightsOfRoles in shared does: download for all but label and viewer, inviting for owner and management.
-- Compared as text: on a new database all migrations share one transaction, where new enum values may not be used yet.
UPDATE "project_members" SET "can_download" = true WHERE "role"::text NOT IN ('label', 'viewer') OR NOT ("extra_roles"::text[] <@ ARRAY['label', 'viewer']);--> statement-breakpoint
UPDATE "project_members" SET "can_invite" = true WHERE "role"::text IN ('owner', 'management') OR "extra_roles"::text[] && ARRAY['owner', 'management'];
