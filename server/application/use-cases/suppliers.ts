/**
 * Fornecedores: busca por CNPJ/CPF em tempo real, lista, ficha, análise de risco,
 * importação da base do UAU e avaliações.
 */
import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  CompanyDTO,
  DocumentLookupDTO,
  EvaluationDTO,
  evaluationSchema,
  ImportResultDTO,
  RiskCheckDTO,
  SupplierFullDTO,
  SupplierListItemDTO,
  supplierUpdateSchema,
} from '../../../shared/contracts'
import { personKindOf } from '../../../shared/domain/document-number'
import { documentChecklist, expiryState } from '../../../shared/domain/documents'
import { weightedAverage } from '../../../shared/domain/evaluation'
import { CLOSED_STATUSES, type RequestStatus } from '../../../shared/domain/request/status'
import { evaluateRisk, type RiskFacts, type RiskLevel } from '../../../shared/domain/risk'
import { PERMISSIONS } from '../../../shared/domain/roles'
import type { SupplierStatus } from '../../../shared/domain/supplier'
import { schema } from '../../infrastructure/db/client'
import { AppError, IntegrationError, notFound, requirePermission } from '../context'
import { toRiskCheck, toSupplierDetail } from '../mappers'
import type { UseCaseDeps } from '../ports'
import { loadDocuments, loadModel, userNames } from '../shared'
import { listCriteria, loadRiskConfigs } from './settings'
import { checkUauPerson, findUauPerson } from './uau-people'

const { documents, documentTypes, evaluations, requests, riskChecks, supplierModels, suppliers, users } = schema

// ----------------------------------------------------------------------------- busca em tempo real

export async function lookupDocument(deps: UseCaseDeps, document: string): Promise<DocumentLookupDTO> {
  requirePermission(deps.ctx.actor, PERMISSIONS.requestCreate, PERMISSIONS.supplierManage)
  const kind = personKindOf(document)
  if (!kind) throw new AppError('INVALID_DOCUMENT', 'CNPJ ou CPF inválido.', 422)

  const companyP: Promise<{ company: CompanyDTO | null; error: string | null }> =
    kind === 'PJ'
      ? deps.company.find(document).then(
          (company) => ({ company, error: null }),
          (err) => ({ company: null, error: err instanceof IntegrationError ? err.message : 'Falha ao consultar a Receita.' }),
        )
      : Promise.resolve({ company: null, error: null })

  const existingP = deps.db
    .select({ id: suppliers.id, legalName: suppliers.legalName, status: suppliers.status })
    .from(suppliers)
    .where(eq(suppliers.document, document))
    .then(async ([s]) => {
      if (!s) return null
      const [open] = await deps.db
        .select({ id: requests.id, number: requests.number })
        .from(requests)
        .where(and(eq(requests.supplierId, s.id), notInArray(requests.status, CLOSED_STATUSES)))
        .limit(1)
      return { id: s.id, legalName: s.legalName, status: s.status as SupplierStatus, openRequestId: open?.id ?? null, openRequestNumber: open?.number ?? null }
    })

  const [company, existing, uau] = await Promise.all([companyP, existingP, checkUauPerson(deps.uau, document)])
  return { document, personKind: kind, company: company.company, companyError: company.error, existing, uau }
}

// ----------------------------------------------------------------------------- lista e ficha

export async function listSuppliers(deps: UseCaseDeps): Promise<SupplierListItemDTO[]> {
  requirePermission(deps.ctx.actor, PERMISSIONS.supplierRead)
  const today = deps.ctx.now()
  const rows = await deps.db
    .select({ s: suppliers, modelName: supplierModels.name })
    .from(suppliers)
    .leftJoin(supplierModels, eq(supplierModels.id, suppliers.modelId))
    .orderBy(suppliers.legalName)

  const evals = await deps.db
    .select({ supplierId: evaluations.supplierId, avg: sql<string>`avg(${evaluations.average})`, n: sql<number>`count(*)::int` })
    .from(evaluations)
    .groupBy(evaluations.supplierId)
  const evalBy = new Map(evals.map((e) => [e.supplierId, e]))

  const docs = await deps.db
    .select({ supplierId: documents.supplierId, expiresAt: documents.expiresAt })
    .from(documents)
    .where(and(isNull(documents.replacedAt), sql`${documents.expiresAt} is not null`))
  const docBy = new Map<string, { expiring: number; expired: number }>()
  for (const d of docs) {
    const st = expiryState(d.expiresAt, today)
    const cur = docBy.get(d.supplierId) ?? { expiring: 0, expired: 0 }
    if (st === 'vencendo') cur.expiring++
    if (st === 'vencido') cur.expired++
    docBy.set(d.supplierId, cur)
  }

  return rows.map(({ s, modelName }) => {
    const e = evalBy.get(s.id)
    const d = docBy.get(s.id)
    return {
      id: s.id,
      document: s.document,
      personKind: s.personKind as 'PJ' | 'PF',
      legalName: s.legalName,
      tradeName: s.tradeName,
      status: s.status as SupplierStatus,
      riskLevel: s.riskLevel as RiskLevel,
      modelName,
      uauCodPes: s.uauCodPes,
      source: s.source as 'app' | 'uau',
      average: e ? Math.round(Number(e.avg) * 100) / 100 : null,
      evaluations: e?.n ?? 0,
      docsExpiring: d?.expiring ?? 0,
      docsExpired: d?.expired ?? 0,
      updatedAt: s.updatedAt.toISOString(),
    }
  })
}

export async function loadRiskChecks(deps: Pick<UseCaseDeps, 'db'>, supplierId: string, limit = 5): Promise<RiskCheckDTO[]> {
  const rows = await deps.db.select().from(riskChecks).where(eq(riskChecks.supplierId, supplierId)).orderBy(desc(riskChecks.ranAt)).limit(limit)
  const names = await userNames(deps.db, rows.map((r) => r.ranBy))
  return rows.map((r) => toRiskCheck(r, r.ranBy ? (names.get(r.ranBy) ?? null) : 'Sistema'))
}

export async function loadEvaluations(deps: Pick<UseCaseDeps, 'db'>, supplierId: string): Promise<EvaluationDTO[]> {
  const rows = await deps.db
    .select({ e: evaluations, name: users.fullName })
    .from(evaluations)
    .innerJoin(users, eq(users.id, evaluations.evaluatorId))
    .where(eq(evaluations.supplierId, supplierId))
    .orderBy(desc(evaluations.createdAt))
  return rows.map(({ e, name }) => ({
    id: e.id,
    workName: e.workName,
    reference: e.reference,
    evaluatorName: name,
    scores: e.scores,
    average: e.average,
    comment: e.comment,
    createdAt: e.createdAt.toISOString(),
  }))
}

export async function getSupplier(deps: UseCaseDeps, id: string): Promise<SupplierFullDTO> {
  requirePermission(deps.ctx.actor, PERMISSIONS.supplierRead)
  const [row] = await deps.db
    .select({ s: suppliers, modelName: supplierModels.name })
    .from(suppliers)
    .leftJoin(supplierModels, eq(supplierModels.id, suppliers.modelId))
    .where(eq(suppliers.id, id))
  if (!row) throw notFound('Fornecedor')
  const [docs, risk, evals, criteria, reqs] = await Promise.all([
    loadDocuments(deps.db, id),
    loadRiskChecks(deps, id),
    loadEvaluations(deps, id),
    listCriteria(deps),
    deps.db
      .select({ id: requests.id, number: requests.number, status: requests.status, createdAt: requests.createdAt })
      .from(requests)
      .where(eq(requests.supplierId, id))
      .orderBy(desc(requests.createdAt)),
  ])
  const avgs = evals.map((e) => e.average).filter((a): a is number => a !== null)
  return {
    supplier: toSupplierDetail(row.s, row.modelName),
    documents: docs,
    riskChecks: risk,
    evaluations: evals,
    criteria,
    average: avgs.length ? Math.round((avgs.reduce((a, b) => a + b, 0) / avgs.length) * 100) / 100 : null,
    requests: reqs.map((r) => ({ id: r.id, number: r.number, status: r.status as RequestStatus, createdAt: r.createdAt.toISOString() })),
  }
}

export async function updateSupplier(deps: UseCaseDeps, id: string, input: z.infer<typeof supplierUpdateSchema>) {
  requirePermission(deps.ctx.actor, PERMISSIONS.supplierManage)
  const [row] = await deps.db
    .update(suppliers)
    .set({ ...input, updatedAt: deps.ctx.now() })
    .where(eq(suppliers.id, id))
    .returning({ id: suppliers.id })
  if (!row) throw notFound('Fornecedor')
  return getSupplier(deps, id)
}

// ----------------------------------------------------------------------------- Receita + risco

/** Atualiza os dados da Receita do fornecedor (só PJ). */
export async function refreshCompanyData(deps: UseCaseDeps, supplierId: string): Promise<CompanyDTO | null> {
  const [s] = await deps.db.select().from(suppliers).where(eq(suppliers.id, supplierId))
  if (!s) throw notFound('Fornecedor')
  if (s.personKind !== 'PJ') return null
  const company = await deps.company.find(s.document)
  if (company) {
    await deps.db
      .update(suppliers)
      .set({ receita: company as unknown as Record<string, unknown>, receitaCheckedAt: deps.ctx.now(), updatedAt: deps.ctx.now() })
      .where(eq(suppliers.id, supplierId))
  }
  return company
}

export async function runRiskCheck(deps: UseCaseDeps, supplierId: string, requestId: string | null): Promise<RiskCheckDTO> {
  requirePermission(deps.ctx.actor, PERMISSIONS.supplierManage, PERMISSIONS.requestAnalyze)
  const [s] = await deps.db.select().from(suppliers).where(eq(suppliers.id, supplierId))
  if (!s) throw notFound('Fornecedor')
  const now = deps.ctx.now()
  const sources: Record<string, unknown> = {}

  let company: CompanyDTO | null = (s.receita as CompanyDTO | null) ?? null
  if (s.personKind === 'PJ') {
    try {
      company = await refreshCompanyData(deps, supplierId)
      sources.receita = company ? { ok: true, fonte: company.fonte } : { ok: false, message: 'CNPJ não encontrado na Receita.' }
    } catch (err) {
      sources.receita = { ok: false, message: err instanceof Error ? err.message : 'Falha na consulta.', usandoUltimaConsulta: !!company }
    }
  } else {
    sources.receita = { ok: false, message: 'Pessoa física: sem consulta à Receita.' }
  }

  const [ceis, cnep] = await Promise.all([deps.sanctions.ceis(s.document), deps.sanctions.cnep(s.document)])
  sources.transparencia = deps.sanctions.configured
    ? { ok: ceis !== null && cnep !== null, ceis: ceis?.items ?? null, cnep: cnep?.items ?? null }
    : { ok: false, message: 'Chave do Portal da Transparência não configurada.' }

  let expectedCnaePrefixes: string[] = []
  let expiredRequiredDocuments = 0
  if (s.modelId) {
    const model = await loadModel(deps.db, s.modelId)
    expectedCnaePrefixes = model.expectedCnaePrefixes
    const docs = await loadDocuments(deps.db, supplierId)
    expiredRequiredDocuments = documentChecklist(model.requirements, docs, now).expired.length
  }

  const facts: RiskFacts = {
    situacaoCadastral: company?.situacaoCadastral ?? null,
    dataAbertura: company?.dataAbertura ?? null,
    capitalSocial: company?.capitalSocial ?? null,
    mei: company?.mei ?? null,
    cnaes: company ? [company.cnaePrincipal?.codigo, ...company.cnaesSecundarios.map((c) => c.codigo)].filter((c): c is string => !!c) : [],
    ceis: ceis ? { count: ceis.count } : null,
    cnep: cnep ? { count: cnep.count } : null,
    expectedCnaePrefixes,
    expiredRequiredDocuments,
  }
  const result = evaluateRisk(await loadRiskConfigs(deps.db), facts, now)
  const [row] = await deps.db
    .insert(riskChecks)
    .values({
      supplierId,
      requestId,
      ranBy: deps.ctx.actor.id,
      level: result.level,
      blocked: result.blocked,
      findings: result.findings,
      facts: facts as unknown as Record<string, unknown>,
      sources,
    })
    .returning()
  await deps.db.update(suppliers).set({ riskLevel: result.level, riskCheckedAt: now, updatedAt: now }).where(eq(suppliers.id, supplierId))
  return toRiskCheck(row!, deps.ctx.actor.fullName)
}

// ----------------------------------------------------------------------------- importação da base do UAU

export async function importFromUau(deps: UseCaseDeps, list: string[]): Promise<ImportResultDTO> {
  requirePermission(deps.ctx.actor, PERMISSIONS.supplierManage)
  const unique = [...new Set(list)]
  const existing = new Map(
    (await deps.db.select({ id: suppliers.id, document: suppliers.document }).from(suppliers).where(inArray(suppliers.document, unique))).map((r) => [
      r.document,
      r.id,
    ]),
  )
  const results: ImportResultDTO['results'] = []
  for (const document of unique) {
    if (existing.has(document)) {
      results.push({ document, outcome: 'ja_existe', message: 'Já está no app.', supplierId: existing.get(document)! })
      continue
    }
    try {
      const person = await findUauPerson(deps.uau, document)
      if (!person) {
        results.push({ document, outcome: 'nao_encontrado', message: 'Não existe no UAU.', supplierId: null })
        continue
      }
      const [s] = await deps.db
        .insert(suppliers)
        .values({
          document,
          personKind: personKindOf(document)!,
          legalName: person.name ?? 'Sem nome no UAU',
          tradeName: person.tradeName,
          email: person.email,
          status: person.active === false ? 'inativo' : 'homologado',
          uauCodPes: person.codPes,
          uauSyncedAt: deps.ctx.now(),
          source: 'uau',
        })
        .returning({ id: suppliers.id })
      results.push({ document, outcome: 'importado', message: `Código UAU ${person.codPes}.`, supplierId: s!.id })
    } catch (err) {
      results.push({ document, outcome: 'erro', message: err instanceof Error ? err.message : 'Falha.', supplierId: null })
    }
  }
  return { results }
}

// ----------------------------------------------------------------------------- avaliações

export async function createEvaluation(deps: UseCaseDeps, input: z.infer<typeof evaluationSchema>): Promise<EvaluationDTO> {
  requirePermission(deps.ctx.actor, PERMISSIONS.evaluationCreate)
  const [s] = await deps.db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, input.supplierId))
  if (!s) throw notFound('Fornecedor')
  const criteria = (await listCriteria(deps)).filter((c) => c.active)
  const scores = Object.fromEntries(Object.entries(input.scores).filter(([k]) => criteria.some((c) => c.id === k)))
  const missing = criteria.filter((c) => scores[c.id] === undefined)
  if (missing.length) throw new AppError('SCORES_MISSING', `Dê nota para: ${missing.map((c) => c.name).join(', ')}.`, 422)
  const average = weightedAverage(criteria, scores)
  const [e] = await deps.db
    .insert(evaluations)
    .values({
      supplierId: input.supplierId,
      evaluatorId: deps.ctx.actor.id,
      workName: input.workName,
      reference: input.reference ?? null,
      scores,
      average,
      comment: input.comment ?? null,
    })
    .returning()
  return {
    id: e!.id,
    workName: e!.workName,
    reference: e!.reference,
    evaluatorName: deps.ctx.actor.fullName,
    scores: e!.scores,
    average: e!.average,
    comment: e!.comment,
    createdAt: e!.createdAt.toISOString(),
  }
}

/** Tipos de documento do fornecedor (para upload pela equipe quando ele não tem modelo). */
export async function activeDocumentTypeIds(deps: UseCaseDeps) {
  return (await deps.db.select({ id: documentTypes.id }).from(documentTypes).where(eq(documentTypes.active, true))).map((r) => r.id)
}
