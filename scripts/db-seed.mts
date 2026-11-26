/**
 * Dados iniciais (idempotente: só insere o que ainda não existe).
 *  - usuário dev (DEV_EMAIL) e três usuários de teste, um por papel
 *  - sugestão de tipos de documento, modelos e critérios (editáveis no Painel dev)
 *  - regras de risco com a gravidade padrão
 *
 * Documentos e modelos por tipo de fornecedor: supplier-docs-catalog.mts
 *
 * Uso: npm run db:seed  (DEV_EMAIL=voce@unitaengenharia.com.br npm run db:seed)
 */
import { existsSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { defaultRuleConfigs } from '../shared/domain/risk'
import * as s from '../server/infrastructure/db/schema'
import { DOC_TYPES, MODELS } from './supplier-docs-catalog.mjs'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')
const db = drizzle(neon(process.env.DATABASE_URL!), { schema: s })

const devEmail = (process.env.DEV_EMAIL ?? 'dev@unitaengenharia.com.br').toLowerCase()

const USERS = [
  { email: devEmail, fullName: 'Administrador Dev', roles: ['dev', 'aprovador', 'analista', 'obra'] },
  { email: 'obra.teste@unitaengenharia.com.br', fullName: 'Obra (teste)', roles: ['obra'] },
  { email: 'analista.teste@unitaengenharia.com.br', fullName: 'Analista (teste)', roles: ['analista'] },
  { email: 'aprovador.teste@unitaengenharia.com.br', fullName: 'Aprovador (teste)', roles: ['aprovador'] },
]

const CRITERIA = [
  { name: 'Prazo de entrega', description: 'Cumpriu os prazos combinados.', weight: 2 },
  { name: 'Qualidade', description: 'Material/serviço conforme especificação, sem retrabalho.', weight: 3 },
  { name: 'Segurança do trabalho', description: 'Uso de EPI, documentação e conduta no canteiro.', weight: 2 },
  { name: 'Atendimento e comunicação', description: 'Resposta rápida, postura, resolução de problemas.', weight: 1 },
  { name: 'Condições comerciais', description: 'Manteve preço e condições acordadas.', weight: 1 },
]

const existingUsers = new Set((await db.select({ email: s.users.email }).from(s.users)).map((u) => u.email))
const newUsers = USERS.filter((u) => !existingUsers.has(u.email))
if (newUsers.length) await db.insert(s.users).values(newUsers)

let docTypes = await db.select().from(s.documentTypes)
if (!docTypes.length) {
  docTypes = await db
    .insert(s.documentTypes)
    .values(DOC_TYPES.map((d, i) => ({ ...d, sort: i })))
    .returning()
}
const docId = (name: string) => docTypes.find((d) => d.name === name)?.id

if (!(await db.select({ id: s.supplierModels.id }).from(s.supplierModels)).length) {
  for (const m of MODELS) {
    const [model] = await db
      .insert(s.supplierModels)
      .values({ name: m.name, description: m.description, personKind: m.personKind, expectedCnaePrefixes: m.cnae })
      .returning()
    await db.insert(s.modelRequirements).values(
      m.reqs
        .filter((r) => docId(r.doc))
        .map((r, i) => ({ modelId: model!.id, documentTypeId: docId(r.doc)!, required: r.required, instructions: r.instructions ?? null, sort: i })),
    )
  }
}

if (!(await db.select({ id: s.evaluationCriteria.id }).from(s.evaluationCriteria)).length) {
  await db.insert(s.evaluationCriteria).values(CRITERIA.map((c, i) => ({ ...c, sort: i })))
}

await db.insert(s.riskRuleConfigs).values(defaultRuleConfigs()).onConflictDoNothing()

console.log(`Seed concluído. Usuários novos: ${newUsers.length}. Usuário dev: ${devEmail}`)
