ALTER TABLE "roles" ADD COLUMN "modules" text[] DEFAULT '{pj}'::text[] NOT NULL;--> statement-breakpoint
-- Todos os cargos atuais ficam só em Fornecedores/PJ (ninguém ganha nem perde acesso); o Dev vê os dois
UPDATE "roles" SET "modules" = '{pj,pf}' WHERE "key" = 'dev';
