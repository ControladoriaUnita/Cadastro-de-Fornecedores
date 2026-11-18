CREATE TABLE "roles" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Cargos iniciais (os mesmos papéis que existiam fixos no código)
INSERT INTO "roles" ("key", "name", "description", "permissions", "system") VALUES
('solicitante', 'Solicitante', 'Pede cadastros, acompanha os próprios e avalia fornecedores.', ARRAY['request.create','request.read.own','supplier.read','evaluation.create','model.read'], false),
('analista', 'Analista de suprimentos', 'Convida fornecedores, confere documentos e risco, envia para aprovação.', ARRAY['request.create','request.read.own','request.read.all','request.analyze','supplier.read','supplier.manage','evaluation.create','model.read'], false),
('aprovador', 'Aprovação', 'Tudo do analista, mais validar e gravar no UAU.', ARRAY['request.create','request.read.own','request.read.all','request.analyze','request.approve','supplier.read','supplier.manage','evaluation.create','model.read'], false),
('dev', 'Dev', 'Acesso total, inclusive configurações, usuários e cargos.', ARRAY['request.create','request.read.own','request.read.all','request.analyze','request.approve','supplier.read','supplier.manage','evaluation.create','model.read','settings.manage','users.manage','dev.panel'], true)
ON CONFLICT ("key") DO NOTHING;
