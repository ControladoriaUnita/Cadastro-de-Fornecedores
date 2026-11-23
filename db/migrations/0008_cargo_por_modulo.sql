ALTER TABLE "roles" ADD COLUMN "module" text;--> statement-breakpoint
-- Módulos independentes: todo cargo pertence a um módulo; o "Dev" vira Dev geral (module NULL, os dois módulos)
UPDATE "roles" SET "module" = 'pj' WHERE "key" <> 'dev';
--> statement-breakpoint
UPDATE "roles" SET "name" = 'Dev geral', "description" = 'Acesso total aos dois módulos (Fornecedores/PJ e Pessoas Físicas/PF).' WHERE "key" = 'dev';
--> statement-breakpoint
-- Dev de cada módulo: administra só o próprio módulo (Painel dev, usuários, cargos)
INSERT INTO "roles" ("key", "name", "description", "permissions", "system", "module") VALUES
('dev-pj', 'Dev PJ', 'Acesso total ao módulo Fornecedores/PJ, inclusive o Painel dev do módulo.', ARRAY['request.create','request.read.own','request.read.all','request.analyze','request.approve','supplier.read','supplier.manage','evaluation.create','model.read','settings.manage','users.manage','dev.panel'], true, 'pj'),
('dev-pf', 'Dev PF', 'Acesso total ao módulo Pessoas Físicas/PF, inclusive o Painel dev do módulo.', ARRAY['request.create','request.read.own','request.read.all','request.analyze','request.approve','supplier.read','supplier.manage','evaluation.create','model.read','settings.manage','users.manage','dev.panel'], true, 'pf')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
-- Tipos de documento por módulo: os tipos usados por modelos de pessoa física ganham cópia no módulo PF
INSERT INTO "document_types" ("name", "description", "has_expiry", "default_validity_days", "active", "sort", "module")
SELECT dt."name", dt."description", dt."has_expiry", dt."default_validity_days", dt."active", dt."sort", 'pf'
FROM "document_types" dt
WHERE dt."module" = 'pj' AND EXISTS (
  SELECT 1 FROM "model_requirements" mr JOIN "supplier_models" m ON m."id" = mr."model_id"
  WHERE mr."document_type_id" = dt."id" AND m."person_kind" = 'PF'
);
--> statement-breakpoint
UPDATE "model_requirements" mr SET "document_type_id" = n."id"
FROM "supplier_models" m, "document_types" o, "document_types" n
WHERE m."id" = mr."model_id" AND m."person_kind" = 'PF' AND o."id" = mr."document_type_id" AND o."module" = 'pj' AND n."module" = 'pf' AND n."name" = o."name";
--> statement-breakpoint
UPDATE "documents" d SET "document_type_id" = n."id"
FROM "suppliers" s, "document_types" o, "document_types" n
WHERE s."id" = d."supplier_id" AND s."person_kind" = 'PF' AND o."id" = d."document_type_id" AND o."module" = 'pj' AND n."module" = 'pf' AND n."name" = o."name";
