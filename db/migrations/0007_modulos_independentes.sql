ALTER TABLE "document_types" ADD COLUMN "module" text DEFAULT 'pj' NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" DROP COLUMN "modules";