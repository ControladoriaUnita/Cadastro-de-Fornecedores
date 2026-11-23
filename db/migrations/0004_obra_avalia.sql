-- A Obra é a principal avaliadora: o cargo ganha "Avaliar fornecedores" (tela "Avaliar", só homologados).
UPDATE "roles" SET "permissions" = array_append("permissions", 'evaluation.create'), "updated_at" = now()
WHERE "key" = 'obra' AND NOT ('evaluation.create' = ANY("permissions"));
