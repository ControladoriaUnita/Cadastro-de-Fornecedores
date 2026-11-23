/**
 * Solicitações de cadastro: abertura, convite ao fornecedor, análise, aprovação e kanban.
 * As transições de situação passam sempre por shared/domain/request/workflow.ts.
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  CreateRequestInput,
  inviteSchema,
  InviteDTO,
  RequestCardDTO,
  RequestDetailDTO,
  reviewDocumentSchema,
} from '../../../shared/contracts'
import { MODULE_INFO, moduleOfKind, type Module } from '../../../shared/domain/modules'
import { formatDocument, personKindOf } from '../../../shared/domain/document-number'
import { documentChecklist } from '../../../shared/domain/documents'
import { CLOSED_STATUSES, type RequestStatus, type Urgency } from '../../../shared/domain/request/status'
import { statusLabel, terms } from '../../../shared/domain/terms'
import { availableActions, transition, type RequestAction } from '../../../shared/domain/request/workflow'
import type { RiskLevel } from '../../../shared/domain/risk'
import { PERMISSIONS } from '../../../shared/domain/roles'
import { supplierProfileSchema } from '../../../shared/domain/supplier'
import { schema } from '../../infrastructure/db/client'
import { inviteEmail } from '../../infrastructure/email/templates'
import { randomToken, sha256 } from '../../infrastructure/security'
import { AppError, can, canModule, notFound, requireModule, requirePermission } from '../context'
import { toEvent, toSupplierDetail } from '../mappers'
import { appUrl, notifyAddresses, notifyPermission, notifyRequester } from '../notifications'
import { loadQualification } from './qualification'
import { resolveWorkName } from './works'
import type { UseCaseDeps } from '../ports'
import { loadDocuments, loadModel, recordEvent, saveDocument } from '../shared'
import { loadRiskChecks } from './suppliers'

const { documents, invites, requestEvents, requests, supplierModels, suppliers, users } = schema

export const INVITE_DAYS = 15

type RequestRow = typeof requests.$inferSelect

async function loadRow(deps: UseCaseDeps, id: string): Promise<RequestRow> {
  const [row] = await deps.db.select({ r: requests, kind: suppliers.personKind }).from(requests).innerJoin(suppliers, eq(suppliers.id, requests.supplierId)).where(eq(requests.id, id))
  if (!row) throw notFound('Solicitação')
  const actor = deps.ctx.actor
  if (!can(actor, PERMISSIONS.requestReadAll) && row.r.requesterId !== actor.id) throw notFound('Solicitação')
  // Gestões separadas: quem não tem o módulo (PJ/PF) não enxerga a solicitação
  if (!canModule(actor, moduleOfKind(row.kind))) throw notFound('Solicitação')
  return row.r
}

/** Aplica a transição, grava a nova situação e o histórico. */
async function move(deps: UseCaseDeps, r: RequestRow, action: RequestAction, opts: { comment?: string | null; payload?: Record<string, unknown>; extra?: Partial<RequestRow> } = {}) {
  const to = transition(r.status as RequestStatus, action, deps.ctx.actor, { requesterId: r.requesterId, comment: opts.comment })
  const now = deps.ctx.now()
  await deps.db
    .update(requests)
    .set({ status: to, updatedAt: now, closedAt: CLOSED_STATUSES.includes(to) ? now : null, ...opts.extra })
    .where(eq(requests.id, r.id))
  await recordEvent(deps.db, {
    requestId: r.id,
    actorId: deps.ctx.actor.id,
    actorLabel: deps.ctx.actor.fullName,
    kind: action,
    fromStatus: r.status as RequestStatus,
    toStatus: to,
    comment: opts.comment,
    payload: opts.payload,
  })
  return to
}

// ----------------------------------------------------------------------------- kanban / lista

export async function listRequests(deps: UseCaseDeps, scope: 'mine' | 'all', module: Module = 'pj'): Promise<RequestCardDTO[]> {
  requirePermission(deps.ctx.actor, PERMISSIONS.requestReadOwn, PERMISSIONS.requestReadAll)
  requireModule(deps.ctx.actor, module)
  const all = scope === 'all' && can(deps.ctx.actor, PERMISSIONS.requestReadAll)
  const rows = await deps.db
    .select({ r: requests, s: suppliers, modelName: supplierModels.name, requester: users.fullName })
    .from(requests)
    .innerJoin(suppliers, eq(suppliers.id, requests.supplierId))
    .leftJoin(supplierModels, eq(supplierModels.id, requests.modelId))
    .innerJoin(users, eq(users.id, requests.requesterId))
    .where(and(eq(suppliers.personKind, MODULE_INFO[module].personKind), all ? undefined : eq(requests.requesterId, deps.ctx.actor.id)))
    .orderBy(desc(requests.updatedAt))
    .limit(500)
  if (!rows.length) return []

  // Progresso de documentos: obrigatórios do modelo × aprovados (envio mais recente de cada tipo)
  const modelIds = [...new Set(rows.map((x) => x.r.modelId).filter((m): m is string => !!m))]
  const reqs = !modelIds.length ? [] : await deps.db
    .select({ modelId: schema.modelRequirements.modelId, typeId: schema.modelRequirements.documentTypeId })
    .from(schema.modelRequirements)
    .where(and(inArray(schema.modelRequirements.modelId, modelIds), eq(schema.modelRequirements.required, true)))
  const docs = await deps.db
    .select({ supplierId: documents.supplierId, typeId: documents.documentTypeId, status: documents.reviewStatus })
    .from(documents)
    .where(and(inArray(documents.supplierId, [...new Set(rows.map((x) => x.s.id))]), isNull(documents.replacedAt)))

  return rows.map(({ r, s, modelName, requester }) => {
    const required = reqs.filter((q) => q.modelId === r.modelId).map((q) => q.typeId)
    const approved = docs.filter((d) => d.supplierId === s.id && d.status === 'aprovado' && required.includes(d.typeId)).length
    return {
      id: r.id,
      number: r.number,
      status: r.status as RequestStatus,
      urgency: r.urgency as Urgency,
      module: moduleOfKind(s.personKind),
      supplierId: s.id,
      supplierName: s.tradeName || s.legalName,
      document: s.document,
      modelName,
      requesterName: requester,
      workName: r.workName,
      riskLevel: s.riskLevel as RiskLevel,
      docs: { approved, required: required.length },
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }
  })
}

// ----------------------------------------------------------------------------- detalhe

async function loadInvite(deps: UseCaseDeps, requestId: string, now: Date): Promise<InviteDTO | null> {
  const [i] = await deps.db.select().from(invites).where(eq(invites.requestId, requestId)).orderBy(desc(invites.createdAt)).limit(1)
  if (!i) return null
  return {
    email: i.email,
    expiresAt: i.expiresAt.toISOString(),
    lastAccessAt: i.lastAccessAt?.toISOString() ?? null,
    verifiedAt: i.verifiedAt?.toISOString() ?? null,
    createdAt: i.createdAt.toISOString(),
    active: !i.revokedAt && i.expiresAt > now,
  }
}

export async function getRequest(deps: UseCaseDeps, id: string): Promise<RequestDetailDTO> {
  const r = await loadRow(deps, id)
  const now = deps.ctx.now()
  const [[s], model, docs, risk, invite, events, [requester], qualification] = await Promise.all([
    deps.db.select({ s: suppliers, modelName: supplierModels.name }).from(suppliers).leftJoin(supplierModels, eq(supplierModels.id, suppliers.modelId)).where(eq(suppliers.id, r.supplierId)),
    r.modelId ? loadModel(deps.db, r.modelId) : Promise.resolve(null),
    loadDocuments(deps.db, r.supplierId),
    loadRiskChecks(deps, r.supplierId, 1),
    loadInvite(deps, r.id, now),
    deps.db.select().from(requestEvents).where(eq(requestEvents.requestId, r.id)).orderBy(desc(requestEvents.at)),
    deps.db.select({ id: users.id, fullName: users.fullName }).from(users).where(eq(users.id, r.requesterId)),
    loadQualification(deps.db, r),
  ])
  return {
    id: r.id,
    number: r.number,
    module: moduleOfKind(s!.s.personKind),
    status: r.status as RequestStatus,
    urgency: r.urgency as Urgency,
    workName: r.workName,
    justification: r.justification,
    contactEmail: r.contactEmail,
    contactName: r.contactName,
    requester: requester ?? { id: r.requesterId, fullName: '—' },
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    supplierSubmittedAt: r.supplierSubmittedAt?.toISOString() ?? null,
    uauSimulated: r.uauSimulated,
    uauResult: r.uauResult ?? null,
    supplier: toSupplierDetail(s!.s, s!.modelName),
    model,
    qualification,
    documents: docs,
    checklist: documentChecklist(model?.requirements ?? [], docs, now),
    latestRisk: risk[0] ?? null,
    invite,
    events: events.map(toEvent),
    actions: availableActions(r.status as RequestStatus, deps.ctx.actor, r.requesterId),
  }
}

// ----------------------------------------------------------------------------- abertura

/** Modelo ativo e compatível com CPF/CNPJ. */
async function activeModelFor(deps: UseCaseDeps, modelId: string, kind: 'PJ' | 'PF') {
  const [model] = await deps.db.select().from(supplierModels).where(eq(supplierModels.id, modelId))
  if (!model || !model.active) throw notFound(`Modelo de ${terms(moduleOfKind(kind)).person}`)
  if (model.personKind !== 'ambos' && model.personKind !== kind) {
    throw new AppError('MODEL_KIND', `O modelo "${model.name}" é para ${model.personKind === 'PJ' ? 'CNPJ' : 'CPF'}.`, 422)
  }
  return model
}

export async function createRequest(deps: UseCaseDeps, input: CreateRequestInput): Promise<{ id: string; number: number }> {
  requirePermission(deps.ctx.actor, PERMISSIONS.requestCreate)
  const kind = personKindOf(input.document)!
  const module: Module = input.module ?? 'pj'
  // Cada módulo aceita só o seu documento: Fornecedores/PJ = CNPJ, Pessoas Físicas/PF = CPF
  if (MODULE_INFO[module].personKind !== kind) {
    throw new AppError('WRONG_MODULE', module === 'pj' ? 'CPF é de pessoa física: use o módulo Pessoas Físicas/PF.' : 'CNPJ é de empresa: use o módulo Fornecedores/PJ.', 422)
  }
  requireModule(deps.ctx.actor, module)
  // Pré-cadastro (Obra) vem sem modelo: Suprimentos escolhe na triagem, antes de enviar o formulário
  const model = input.modelId ? await activeModelFor(deps, input.modelId, kind) : null
  if (input.sendInvite && !model) throw new AppError('MODEL_REQUIRED', `Escolha o modelo de ${terms(module).person} para já enviar o formulário.`, 422)

  let [supplier] = await deps.db.select().from(suppliers).where(eq(suppliers.document, input.document))
  if (supplier) {
    const [open] = await deps.db
      .select({ number: requests.number })
      .from(requests)
      .where(and(eq(requests.supplierId, supplier.id), inArray(requests.status, ['solicitado', 'aguardando_fornecedor', 'em_analise', 'pendencias', 'aguardando_aprovacao'])))
    if (open) throw new AppError('OPEN_REQUEST', `${module === 'pf' ? 'Esta pessoa' : 'Este fornecedor'} já tem a solicitação nº ${open.number} em andamento.`, 409)
    await deps.db.update(suppliers).set({ ...(model ? { modelId: model.id } : {}), email: input.contactEmail, updatedAt: deps.ctx.now() }).where(eq(suppliers.id, supplier.id))
  } else {
    let company = null
    if (kind === 'PJ') company = await deps.company.find(input.document).catch(() => null)
    ;[supplier] = await deps.db
      .insert(suppliers)
      .values({
        document: input.document,
        personKind: kind,
        legalName: company?.razaoSocial || input.contactName || formatDocument(input.document),
        tradeName: company?.nomeFantasia ?? null,
        email: input.contactEmail,
        modelId: model?.id ?? null,
        receita: company as unknown as Record<string, unknown> | null,
        receitaCheckedAt: company ? deps.ctx.now() : null,
      })
      .returning()
  }

  const [r] = await deps.db
    .insert(requests)
    .values({
      supplierId: supplier!.id,
      modelId: model?.id ?? null,
      requesterId: deps.ctx.actor.id,
      urgency: input.urgency,
      workName: input.workName ? await resolveWorkName(deps.db, input.workName) : null,
      justification: input.justification ?? null,
      contactEmail: input.contactEmail,
      contactName: input.contactName ?? null,
    })
    .returning()
  await recordEvent(deps.db, { requestId: r!.id, actorId: deps.ctx.actor.id, actorLabel: deps.ctx.actor.fullName, kind: 'created', toStatus: 'solicitado' })

  if (input.sendInvite && can(deps.ctx.actor, PERMISSIONS.requestAnalyze)) {
    await inviteSupplier(deps, r!.id, {})
  } else {
    await notifyPermission(deps.db, deps.mailer, PERMISSIONS.requestAnalyze, {
      title: `Nova solicitação nº ${r!.number}`,
      lines: [`${deps.ctx.actor.fullName} pediu o cadastro de ${supplier!.legalName} (${formatDocument(supplier!.document)}).`],
      path: `/solicitacoes/${r!.id}`,
      requestId: r!.id,
    }, module)
  }
  return { id: r!.id, number: r!.number }
}

// ----------------------------------------------------------------------------- convite / link do fornecedor

async function issueInvite(deps: UseCaseDeps, r: RequestRow, email: string, pending: string | null, message: string | null) {
  const now = deps.ctx.now()
  await deps.db.update(invites).set({ revokedAt: now }).where(and(eq(invites.requestId, r.id), isNull(invites.revokedAt)))
  const token = randomToken()
  const expiresAt = new Date(now.getTime() + INVITE_DAYS * 86_400_000)
  await deps.db.insert(invites).values({ requestId: r.id, email, tokenHash: sha256(token), expiresAt })
  const [s] = await deps.db.select({ name: suppliers.legalName, kind: suppliers.personKind }).from(suppliers).where(eq(suppliers.id, r.supplierId))
  const link = `${appUrl()}/portal/${token}`
  const module = moduleOfKind(s?.kind ?? 'PJ')
  const mail = inviteEmail({ supplierName: s?.name ?? (module === 'pf' ? 'você' : 'sua empresa'), link, expiresAt, pending, message, module })
  await deps.mailer.send({ ...mail, to: [email], requestId: r.id })
  return { email, expiresAt }
}

export async function inviteSupplier(deps: UseCaseDeps, id: string, input: z.infer<typeof inviteSchema>) {
  const r = await loadRow(deps, id)
  const email = input.email ?? r.contactEmail
  // Permissão e etapa ANTES de mexer em qualquer dado (transition lança se não puder)
  transition(r.status as RequestStatus, 'invite', deps.ctx.actor, { requesterId: r.requesterId })
  // Triagem de Suprimentos: o modelo (documentos exigidos) é definido aqui quando a Obra não escolheu
  let modelId = r.modelId
  if (input.modelId && input.modelId !== r.modelId) {
    const [s] = await deps.db.select({ document: suppliers.document }).from(suppliers).where(eq(suppliers.id, r.supplierId))
    modelId = (await activeModelFor(deps, input.modelId, personKindOf(s!.document)!)).id
  }
  if (!modelId) throw new AppError('MODEL_REQUIRED', `Escolha o modelo de ${terms(deps.ctx.module).person} antes de enviar o formulário.`, 422)
  await move(deps, r, 'invite', { payload: { email, modelId }, extra: { contactEmail: email, analystId: r.analystId ?? deps.ctx.actor.id, modelId } })
  if (modelId !== r.modelId) await deps.db.update(suppliers).set({ modelId, updatedAt: deps.ctx.now() }).where(eq(suppliers.id, r.supplierId))
  await issueInvite(deps, r, email, null, input.message ?? null)
  return getRequest(deps, id)
}

export async function requestChanges(deps: UseCaseDeps, id: string, comment: string) {
  const r = await loadRow(deps, id)
  await move(deps, r, 'request_changes', { comment })
  await issueInvite(deps, r, r.contactEmail, comment, null)
  return getRequest(deps, id)
}

// ----------------------------------------------------------------------------- análise e aprovação

export async function cancelRequest(deps: UseCaseDeps, id: string, comment: string | null) {
  const r = await loadRow(deps, id)
  await move(deps, r, 'cancel', { comment })
  await deps.db.update(invites).set({ revokedAt: deps.ctx.now() }).where(and(eq(invites.requestId, id), isNull(invites.revokedAt)))
  await notifyRequester(
    deps.db,
    deps.mailer,
    r.requesterId,
    { title: `Solicitação nº ${r.number} cancelada`, lines: [`Cancelada por ${deps.ctx.actor.fullName}.`, ...(comment ? [`Motivo: ${comment}`] : [])], path: `/solicitacoes/${id}`, requestId: id, module: deps.ctx.module },
    deps.ctx.actor.id,
  )
  return getRequest(deps, id)
}

export async function rejectRequest(deps: UseCaseDeps, id: string, comment: string) {
  const r = await loadRow(deps, id)
  await move(deps, r, 'reject', { comment })
  await deps.db.update(invites).set({ revokedAt: deps.ctx.now() }).where(and(eq(invites.requestId, id), isNull(invites.revokedAt)))
  const [requester] = await deps.db.select({ email: users.email }).from(users).where(eq(users.id, r.requesterId))
  await notifyAddresses(deps.mailer, [requester?.email ?? ''], {
    title: `Solicitação nº ${r.number} recusada`,
    lines: [`Motivo: ${comment}`],
    path: `/solicitacoes/${id}`,
    requestId: id,
    module: deps.ctx.module,
  })
  return getRequest(deps, id)
}

/** Motivos que impedem enviar para aprovação (vazio = pode enviar). */
export function approvalBlockers(detail: RequestDetailDTO): string[] {
  const blockers: string[] = []
  const c = detail.checklist
  const t = terms(detail.module)
  if (!detail.model) return [`Defina o modelo de ${t.person}.`]
  const model = detail.model
  const names = (ids: string[]) => ids.map((id) => model.requirements.find((q) => q.documentTypeId === id)?.name ?? id).join(', ')
  if (c.missing.length) blockers.push(`Documentos obrigatórios faltando: ${names(c.missing)}.`)
  if (c.pendingReview.length) blockers.push(`Documentos ainda não conferidos: ${names(c.pendingReview)}.`)
  if (c.rejected.length) blockers.push(`Documentos reprovados: ${names(c.rejected)}.`)
  if (c.expired.length) blockers.push(`Documentos vencidos: ${names(c.expired)}.`)
  const profile = supplierProfileSchema.safeParse(detail.supplier.profile)
  if (!profile.success) blockers.push(`Ficha cadastral ${t.ofPerson} incompleta ou inválida.`)
  // Pessoas Físicas/PF: sem homologação (formulário de qualificação) e sem análise de risco
  if (detail.module === 'pf') return blockers
  if (!detail.qualification.complete) {
    const missing = detail.qualification.total - detail.qualification.answered
    blockers.push(detail.qualification.total ? `Responda o formulário de qualificação (${missing} pergunta(s) sem resposta).` : 'Cadastre as perguntas do formulário de qualificação no Painel dev.')
  }
  if (!detail.latestRisk) blockers.push('Rode a análise de risco.')
  else if (detail.latestRisk.blocked) blockers.push('A análise de risco tem item que bloqueia a homologação.')
  else if (detail.supplierSubmittedAt && detail.latestRisk.ranAt < detail.supplierSubmittedAt) blockers.push('Rode a análise de risco de novo (o fornecedor enviou dados depois da última).')
  return blockers
}

export async function sendToApproval(deps: UseCaseDeps, id: string) {
  const detail = await getRequest(deps, id)
  const blockers = approvalBlockers(detail)
  if (blockers.length) throw new AppError('NOT_READY', blockers.join(' '), 422, { blockers })
  const r = await loadRow(deps, id)
  await move(deps, r, 'send_to_approval')
  await notifyPermission(deps.db, deps.mailer, PERMISSIONS.requestApprove, {
    title: `Solicitação nº ${r.number} aguardando aprovação`,
    lines: [`${detail.supplier.legalName} (${formatDocument(detail.supplier.document)}) está pronto para ${detail.module === 'pf' ? 'aprovar' : 'homologar'} e gravar no UAU.`],
    path: `/validacao/${id}`,
    requestId: id,
  }, detail.module)
  return getRequest(deps, id)
}

export async function returnToAnalysis(deps: UseCaseDeps, id: string, comment: string) {
  const r = await loadRow(deps, id)
  await move(deps, r, 'return_to_analysis', { comment })
  return getRequest(deps, id)
}

export async function reviewDocument(deps: UseCaseDeps, requestId: string, documentId: string, input: z.infer<typeof reviewDocumentSchema>) {
  requirePermission(deps.ctx.actor, PERMISSIONS.requestAnalyze)
  const r = await loadRow(deps, requestId)
  if (!['em_analise', 'pendencias', 'aguardando_fornecedor'].includes(r.status)) {
    throw new AppError('INVALID_TRANSITION', `Documentos não podem ser conferidos na etapa "${statusLabel(r.status as RequestStatus, deps.ctx.module)}".`, 409)
  }
  if (input.status === 'reprovado' && !input.note?.trim()) throw new AppError('COMMENT_REQUIRED', 'Informe o motivo da reprovação.', 422)
  const now = deps.ctx.now()
  const [doc] = await deps.db
    .update(documents)
    .set({
      reviewStatus: input.status,
      reviewNote: input.note ?? null,
      reviewedBy: deps.ctx.actor.id,
      reviewedAt: now,
      ...(input.issuedAt !== undefined ? { issuedAt: input.issuedAt } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    })
    .where(and(eq(documents.id, documentId), eq(documents.supplierId, r.supplierId)))
    .returning()
  if (!doc) throw notFound('Documento')
  await recordEvent(deps.db, {
    requestId,
    actorId: deps.ctx.actor.id,
    actorLabel: deps.ctx.actor.fullName,
    kind: input.status === 'aprovado' ? 'document_approved' : 'document_rejected',
    comment: input.note ?? null,
    payload: { documentId, fileName: doc.fileName },
  })
  return getRequest(deps, requestId)
}

export async function staffUpload(deps: UseCaseDeps, requestId: string, form: { file: File; documentTypeId: string; issuedAt: string | null; expiresAt: string | null }) {
  requirePermission(deps.ctx.actor, PERMISSIONS.requestAnalyze)
  const r = await loadRow(deps, requestId)
  if (CLOSED_STATUSES.includes(r.status as RequestStatus)) throw new AppError('CLOSED', 'Solicitação encerrada.', 409)
  if (!r.modelId) throw new AppError('MODEL_REQUIRED', `Defina o modelo de ${terms(deps.ctx.module).person} antes de anexar documentos.`, 422)
  const model = await loadModel(deps.db, r.modelId)
  const doc = await saveDocument(
    deps.db,
    deps.storage,
    {
      supplierId: r.supplierId,
      requestId,
      documentTypeId: form.documentTypeId,
      file: form.file,
      issuedAt: form.issuedAt,
      expiresAt: form.expiresAt,
      uploadedBy: 'user',
      userId: deps.ctx.actor.id,
      allowedTypeIds: model.requirements.map((q) => q.documentTypeId),
    },
    deps.ctx.now(),
  )
  await recordEvent(deps.db, {
    requestId,
    actorId: deps.ctx.actor.id,
    actorLabel: deps.ctx.actor.fullName,
    kind: 'document_uploaded',
    payload: { documentId: doc.id, fileName: doc.fileName, type: doc.documentTypeName },
  })
  return getRequest(deps, requestId)
}
