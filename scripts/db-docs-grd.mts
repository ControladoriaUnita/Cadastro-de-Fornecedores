/**
 * Atualiza no banco existente a documentação exigida por tipo de fornecedor (módulo PJ),
 * conforme supplier-docs-catalog.mts (GRD rev. 06).
 *
 *  - cria/atualiza os tipos de documento do catálogo (por nome; renomeia os listados em DOC_TYPE_RENAMES)
 *  - cria/atualiza os modelos Materiais, Prestador, Laboratório e Locação e reescreve os documentos exigidos
 *  - não mexe em MEI, Pessoa física, nem em tipos de documento fora do catálogo
 *
 * Idempotente. Uso: npx tsx scripts/db-docs-grd.mts
 */
import { existsSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/neon-http'
import * as s from '../server/infrastructure/db/schema'
import { DOC_TYPE_RENAMES, DOC_TYPES, GRD_MODELS, MODEL_RENAMES } from './supplier-docs-catalog.mjs'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')
const db = drizzle(neon(process.env.DATABASE_URL!), { schema: s })
const MODULE = 'pj'

// Tipos de documento
for (const [from, to] of Object.entries(DOC_TYPE_RENAMES)) {
  const exists = await db.select({ id: s.documentTypes.id }).from(s.documentTypes).where(and(eq(s.documentTypes.module, MODULE), eq(s.documentTypes.name, to)))
  if (!exists.length) await db.update(s.documentTypes).set({ name: to }).where(and(eq(s.documentTypes.module, MODULE), eq(s.documentTypes.name, from)))
}
const current = await db.select().from(s.documentTypes).where(eq(s.documentTypes.module, MODULE))
const maxSort = Math.max(0, ...current.map((d) => d.sort))
const docIds = new Map<string, string>()
for (const [i, d] of DOC_TYPES.entries()) {
  const values = { description: d.description, hasExpiry: d.hasExpiry, defaultValidityDays: d.defaultValidityDays ?? null, active: true }
  const found = current.find((c) => c.name === d.name)
  if (found) {
    await db.update(s.documentTypes).set(values).where(eq(s.documentTypes.id, found.id))
    docIds.set(d.name, found.id)
  } else {
    const [row] = await db.insert(s.documentTypes).values({ name: d.name, ...values, module: MODULE, sort: maxSort + 1 + i }).returning()
    docIds.set(d.name, row!.id)
  }
}

// Modelos
for (const [from, to] of Object.entries(MODEL_RENAMES)) {
  const exists = await db.select({ id: s.supplierModels.id }).from(s.supplierModels).where(eq(s.supplierModels.name, to))
  if (!exists.length) await db.update(s.supplierModels).set({ name: to }).where(eq(s.supplierModels.name, from))
}
for (const m of GRD_MODELS) {
  const values = { description: m.description, personKind: m.personKind, expectedCnaePrefixes: m.cnae, active: true }
  const [found] = await db.select().from(s.supplierModels).where(eq(s.supplierModels.name, m.name))
  const model = found
    ? (await db.update(s.supplierModels).set(values).where(eq(s.supplierModels.id, found.id)).returning())[0]!
    : (await db.insert(s.supplierModels).values({ name: m.name, ...values }).returning())[0]!
  await db.delete(s.modelRequirements).where(eq(s.modelRequirements.modelId, model.id))
  await db.insert(s.modelRequirements).values(
    m.reqs.map((r, i) => ({ modelId: model.id, documentTypeId: docIds.get(r.doc)!, required: r.required, instructions: r.instructions ?? null, sort: i })),
  )
  console.log(`${found ? 'Atualizado' : 'Criado'}: ${m.name} — ${m.reqs.filter((r) => r.required).length} obrigatórios, ${m.reqs.filter((r) => !r.required).length} condicionais`)
}
console.log('Documentação por tipo de fornecedor atualizada.')
