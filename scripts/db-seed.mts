/**
 * Dados iniciais (idempotente: só insere o que ainda não existe).
 *  - usuário dev (DEV_EMAIL) e três usuários de teste, um por papel
 *  - sugestão de tipos de documento, modelos e critérios (editáveis no Painel dev)
 *  - regras de risco com a gravidade padrão
 *
 * Uso: npm run db:seed  (DEV_EMAIL=voce@unitaengenharia.com.br npm run db:seed)
 */
import { existsSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { defaultRuleConfigs } from '../shared/domain/risk'
import * as s from '../server/infrastructure/db/schema'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')
const db = drizzle(neon(process.env.DATABASE_URL!), { schema: s })

const devEmail = (process.env.DEV_EMAIL ?? 'dev@unitaengenharia.com.br').toLowerCase()

const USERS = [
  { email: devEmail, fullName: 'Administrador Dev', roles: ['dev', 'aprovador', 'analista', 'obra'] },
  { email: 'obra.teste@unitaengenharia.com.br', fullName: 'Obra (teste)', roles: ['obra'] },
  { email: 'analista.teste@unitaengenharia.com.br', fullName: 'Analista (teste)', roles: ['analista'] },
  { email: 'aprovador.teste@unitaengenharia.com.br', fullName: 'Aprovador (teste)', roles: ['aprovador'] },
]

const DOC_TYPES = [
  { name: 'Cartão CNPJ', description: 'Comprovante de inscrição e situação cadastral (Receita Federal).', hasExpiry: false },
  { name: 'Contrato social / última alteração', description: 'Ato constitutivo e última alteração consolidada.', hasExpiry: false },
  { name: 'CND Federal (Receita/PGFN)', description: 'Certidão de débitos relativos a tributos federais e dívida ativa.', hasExpiry: true, defaultValidityDays: 180 },
  { name: 'CRF — FGTS', description: 'Certificado de regularidade do FGTS (Caixa).', hasExpiry: true, defaultValidityDays: 30 },
  { name: 'CNDT — Débitos trabalhistas', description: 'Certidão negativa de débitos trabalhistas (TST).', hasExpiry: true, defaultValidityDays: 180 },
  { name: 'Certidão estadual', description: 'Regularidade com a Fazenda Estadual.', hasExpiry: true, defaultValidityDays: 90 },
  { name: 'Certidão municipal', description: 'Regularidade com a Fazenda Municipal.', hasExpiry: true, defaultValidityDays: 90 },
  { name: 'Comprovante bancário', description: 'Cabeçalho de extrato ou declaração do banco com titularidade da conta.', hasExpiry: false },
  { name: 'Documento do responsável', description: 'RG ou CNH do sócio/representante legal.', hasExpiry: false },
  { name: 'CCMEI', description: 'Certificado da condição de microempreendedor individual.', hasExpiry: false },
  { name: 'Registro no CREA/CAU', description: 'Registro da empresa e do responsável técnico.', hasExpiry: true, defaultValidityDays: 365 },
  { name: 'PGR / PCMSO', description: 'Programas de gerenciamento de riscos e de saúde ocupacional.', hasExpiry: true, defaultValidityDays: 365 },
]

const MODELS: { name: string; description: string; personKind: string; cnae: string[]; docs: string[]; optional?: string[] }[] = [
  {
    name: 'Fornecedor de materiais',
    description: 'Venda de materiais de construção e insumos.',
    personKind: 'PJ',
    cnae: [],
    docs: ['Cartão CNPJ', 'Contrato social / última alteração', 'CND Federal (Receita/PGFN)', 'CRF — FGTS', 'CNDT — Débitos trabalhistas', 'Comprovante bancário'],
    optional: ['Certidão estadual'],
  },
  {
    name: 'Empreiteiro / prestador de serviço de obra',
    description: 'Mão de obra e serviços executados no canteiro.',
    personKind: 'PJ',
    cnae: ['41', '42', '43'],
    docs: ['Cartão CNPJ', 'Contrato social / última alteração', 'CND Federal (Receita/PGFN)', 'CRF — FGTS', 'CNDT — Débitos trabalhistas', 'Certidão municipal', 'Comprovante bancário', 'PGR / PCMSO', 'Documento do responsável'],
    optional: ['Registro no CREA/CAU'],
  },
  {
    name: 'MEI',
    description: 'Microempreendedor individual.',
    personKind: 'PJ',
    cnae: [],
    docs: ['Cartão CNPJ', 'CCMEI', 'CND Federal (Receita/PGFN)', 'Comprovante bancário', 'Documento do responsável'],
  },
  {
    name: 'Pessoa física',
    description: 'Autônomo / pessoa física.',
    personKind: 'PF',
    cnae: [],
    docs: ['Documento do responsável', 'Comprovante bancário'],
  },
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
    const reqs = [
      ...m.docs.map((n) => ({ name: n, required: true })),
      ...(m.optional ?? []).map((n) => ({ name: n, required: false })),
    ]
    await db.insert(s.modelRequirements).values(
      reqs
        .filter((r) => docId(r.name))
        .map((r, i) => ({ modelId: model!.id, documentTypeId: docId(r.name)!, required: r.required, sort: i })),
    )
  }
}

if (!(await db.select({ id: s.evaluationCriteria.id }).from(s.evaluationCriteria)).length) {
  await db.insert(s.evaluationCriteria).values(CRITERIA.map((c, i) => ({ ...c, sort: i })))
}

await db.insert(s.riskRuleConfigs).values(defaultRuleConfigs()).onConflictDoNothing()

console.log(`Seed concluído. Usuários novos: ${newUsers.length}. Usuário dev: ${devEmail}`)
