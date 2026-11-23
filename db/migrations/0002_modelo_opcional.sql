ALTER TABLE "requests" ALTER COLUMN "model_id" DROP NOT NULL;--> statement-breakpoint
-- Cargo "Solicitante" vira "Obra": faz o pré-cadastro e acompanha as próprias solicitações (permissões editáveis no Painel dev)
INSERT INTO "roles" ("key", "name", "description", "permissions", "system") VALUES
('obra', 'Obra', 'Faz o pré-cadastro do fornecedor e acompanha as próprias solicitações.', ARRAY['request.create','request.read.own'], false)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
UPDATE "users" SET "roles" = array_replace("roles", 'solicitante', 'obra') WHERE 'solicitante' = ANY("roles");
--> statement-breakpoint
DELETE FROM "roles" WHERE "key" = 'solicitante';
