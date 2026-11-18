/**
 * Portal do fornecedor (sem conta, sem senha):
 *  1. Link pessoal por e-mail (token aleatório; só o hash fica no banco; vale INVITE_DAYS dias)
 *  2. Ao abrir, pede um código de 6 dígitos enviado ao mesmo e-mail (10 min, 5 tentativas)
 *  3. Código certo → cookie de sessão do portal, preso àquele convite
 * O fornecedor só enxerga e altera a própria solicitação, e só enquanto ela está com ele.
 */
import { and, desc, eq } from 'drizzle-orm'
import type { CompanyDTO, PortalDataDTO, PortalStateDTO } from '../../../shared/contracts'
import { formatDocument } from '../../../shared/domain/document-number'
import { documentChecklist } from '../../../shared/domain/documents'
import { SUPPLIER_CAN_EDIT, type RequestStatus } from '../../../shared/domain/request/status'
import { transition } from '../../../shared/domain/request/workflow'
import { PERMISSIONS } from '../../../shared/domain/roles'
import { supplierProfileSchema } from '../../../shared/domain/supplier'
import { schema } from '../../infrastructure/db/client'
import { codeEmail } from '../../infrastructure/email/templates'
import { randomCode, safeEqualHex, sha256, signSession } from '../../infrastructure/security'
import { AppError, notFound } from '../context'
import { notifyPermission } from '../notifications'
import type { PortalDeps } from '../ports'
import { loadDocuments, loadModel, readDocumentFile, recordEvent, saveDocument } from '../shared'

const { invites, requestEvents, requests, suppliers } = schema

const CODE_TTL_MS = 10 * 60_000
const CODE_RESEND_MS = 60_000
const MAX_ATTEMPTS = 5
const SESSION_HOURS = 8

const invalidLink = () => new AppError('INVALID_LINK', 'Link inválido ou expirado. Peça um novo link a quem solicitou seu cadastro.', 404)

function maskEmail(email: string) {
  const [user, domain] = email.split('@')
  if (!user || !domain) return email
  return `${user.slice(0, 2)}${'•'.repeat(Math.max(1, user.length - 2))}@${domain}`
}

async function inviteByToken(deps: PortalDeps, token: string) {
  if (!/^[\w-]{20,100}$/.test(token)) throw invalidLink()
  const [i] = await deps.db.select().from(invites).where(eq(invites.tokenHash, sha256(token)))
  if (!i || i.revokedAt || i.expiresAt < deps.now()) throw invalidLink()
  return i
}

async function inviteById(deps: PortalDeps, id: string) {
  const [i] = await deps.db.select().from(invites).where(eq(invites.id, id))
  if (!i || i.revokedAt || i.expiresAt < deps.now()) throw new AppError('PORTAL_SESSION', 'Sua sessão expirou. Abra o link do e-mail de novo.', 401)
  const [r] = await deps.db.select().from(requests).where(eq(requests.id, i.requestId))
  const [s] = r ? await deps.db.select().from(suppliers).where(eq(suppliers.id, r.supplierId)) : []
  if (!r || !s) throw invalidLink()
  return { invite: i, request: r, supplier: s }
}

export async function portalState(deps: PortalDeps, token: string, sessionInviteId: string | null): Promise<PortalStateDTO> {
  const i = await inviteByToken(deps, token)
  const [r] = await deps.db.select({ supplierId: requests.supplierId }).from(requests).where(eq(requests.id, i.requestId))
  const [s] = await deps.db.select({ name: suppliers.legalName }).from(suppliers).where(eq(suppliers.id, r!.supplierId))
  return { stage: sessionInviteId === i.id ? 'ready' : 'needs_code', emailHint: maskEmail(i.email), companyName: s?.name ?? '' }
}

export async function sendCode(deps: PortalDeps, token: string) {
  const i = await inviteByToken(deps, token)
  const now = deps.now()
  if (i.codeExpiresAt && i.codeExpiresAt.getTime() - CODE_TTL_MS + CODE_RESEND_MS > now.getTime()) {
    throw new AppError('CODE_RECENT', 'Aguarde um minuto para pedir outro código.', 429)
  }
  const code = randomCode()
  await deps.db
    .update(invites)
    .set({ codeHash: sha256(`${i.id}:${code}`), codeExpiresAt: new Date(now.getTime() + CODE_TTL_MS), codeAttempts: 0 })
    .where(eq(invites.id, i.id))
  await deps.mailer.send({ ...codeEmail({ code }), to: [i.email], requestId: i.requestId })
  return { emailHint: maskEmail(i.email) }
}

/** Confere o código e devolve o valor do cookie de sessão do portal. */
export async function verifyCode(deps: PortalDeps, token: string, code: string): Promise<{ cookie: string; maxAge: number }> {
  const i = await inviteByToken(deps, token)
  const now = deps.now()
  if (!i.codeHash || !i.codeExpiresAt || i.codeExpiresAt < now) throw new AppError('CODE_EXPIRED', 'Código expirado. Peça um novo.', 422)
  if (i.codeAttempts >= MAX_ATTEMPTS) throw new AppError('CODE_LOCKED', 'Muitas tentativas. Peça um novo código.', 429)
  if (!safeEqualHex(sha256(`${i.id}:${code}`), i.codeHash)) {
    await deps.db.update(invites).set({ codeAttempts: i.codeAttempts + 1 }).where(eq(invites.id, i.id))
    throw new AppError('CODE_INVALID', `Código incorreto. Restam ${MAX_ATTEMPTS - i.codeAttempts - 1} tentativa(s).`, 422)
  }
  await deps.db.update(invites).set({ codeHash: null, codeExpiresAt: null, verifiedAt: i.verifiedAt ?? now, lastAccessAt: now }).where(eq(invites.id, i.id))
  const exp = Math.min(i.expiresAt.getTime(), now.getTime() + SESSION_HOURS * 3_600_000)
  const maxAge = Math.floor((exp - now.getTime()) / 1000)
  return { cookie: signSession({ kind: 'supplier', sub: i.id, exp: Math.floor(exp / 1000) }), maxAge }
}

/** Ficha inicial a partir da Receita, para o fornecedor só conferir. */
function prefillFromCompany(c: CompanyDTO | null, email: string | null): Record<string, unknown> {
  if (!c) return email ? { email } : {}
  const phone = (c.telefone ?? '').replace(/\D/g, '')
  return {
    legalName: c.razaoSocial,
    tradeName: c.nomeFantasia,
    email: email ?? c.email,
    phoneDdd: phone.slice(0, 2) || undefined,
    phoneNumber: phone.slice(2) || undefined,
    mainCnae: c.cnaePrincipal?.codigo,
    simplesNacional: c.simples,
    address: {
      cep: c.endereco.cep,
      street: c.endereco.logradouro,
      number: c.endereco.numero,
      complement: c.endereco.complemento,
      district: c.endereco.bairro,
      city: c.endereco.municipio,
      uf: c.endereco.uf,
    },
  }
}

export async function portalData(deps: PortalDeps, inviteId: string): Promise<PortalDataDTO> {
  const { invite, request: r, supplier: s } = await inviteById(deps, inviteId)
  await deps.db.update(invites).set({ lastAccessAt: deps.now() }).where(eq(invites.id, invite.id))
  const model = await loadModel(deps.db, r.modelId)
  const docs = await loadDocuments(deps.db, s.id)
  let pendingNote: string | null = null
  if (r.status === 'pendencias') {
    const [e] = await deps.db
      .select({ comment: requestEvents.comment })
      .from(requestEvents)
      .where(and(eq(requestEvents.requestId, r.id), eq(requestEvents.kind, 'request_changes')))
      .orderBy(desc(requestEvents.at))
      .limit(1)
    pendingNote = e?.comment ?? null
  }
  const hasProfile = Object.keys(s.profile).length > 0
  return {
    requestNumber: r.number,
    status: r.status as RequestStatus,
    canEdit: SUPPLIER_CAN_EDIT.includes(r.status as RequestStatus),
    personKind: s.personKind as 'PJ' | 'PF',
    document: s.document,
    modelName: model.name,
    pendingNote,
    profile: hasProfile ? s.profile : prefillFromCompany((s.receita as CompanyDTO | null) ?? null, r.contactEmail),
    requirements: model.requirements,
    documents: docs.filter((d) => model.requirements.some((q) => q.documentTypeId === d.documentTypeId)),
    submittedAt: r.supplierSubmittedAt?.toISOString() ?? null,
  }
}

async function editable(deps: PortalDeps, inviteId: string) {
  const ctx = await inviteById(deps, inviteId)
  if (!SUPPLIER_CAN_EDIT.includes(ctx.request.status as RequestStatus)) {
    throw new AppError('PORTAL_LOCKED', 'Seu cadastro já foi enviado e está em análise. Aguarde o retorno da Unità.', 409)
  }
  return ctx
}

export async function saveProfile(deps: PortalDeps, inviteId: string, profile: Record<string, unknown>) {
  const { supplier: s } = await editable(deps, inviteId)
  const clean: Record<string, unknown> = { ...profile, document: s.document }
  const name = typeof clean.legalName === 'string' && clean.legalName.trim() ? clean.legalName.trim().slice(0, 100) : s.legalName
  const trade = typeof clean.tradeName === 'string' ? clean.tradeName.trim().slice(0, 100) || null : s.tradeName
  await deps.db
    .update(suppliers)
    .set({ profile: clean, legalName: name, tradeName: trade, updatedAt: deps.now() })
    .where(eq(suppliers.id, s.id))
  return portalData(deps, inviteId)
}

export async function portalUpload(deps: PortalDeps, inviteId: string, form: { file: File; documentTypeId: string; issuedAt: string | null; expiresAt: string | null }) {
  const { request: r, supplier: s } = await editable(deps, inviteId)
  const model = await loadModel(deps.db, r.modelId)
  const doc = await saveDocument(
    deps.db,
    deps.storage,
    {
      supplierId: s.id,
      requestId: r.id,
      documentTypeId: form.documentTypeId,
      file: form.file,
      issuedAt: form.issuedAt,
      expiresAt: form.expiresAt,
      uploadedBy: 'supplier',
      userId: null,
      allowedTypeIds: model.requirements.map((q) => q.documentTypeId),
    },
    deps.now(),
  )
  await recordEvent(deps.db, {
    requestId: r.id,
    actorId: null,
    actorLabel: 'Fornecedor',
    kind: 'document_uploaded',
    payload: { documentId: doc.id, fileName: doc.fileName, type: doc.documentTypeName },
  })
  return portalData(deps, inviteId)
}

export async function portalSubmit(deps: PortalDeps, inviteId: string) {
  const { request: r, supplier: s } = await editable(deps, inviteId)
  const parsed = supplierProfileSchema.safeParse({ ...s.profile, document: s.document })
  if (!parsed.success) {
    throw new AppError('PROFILE_INVALID', 'Confira os dados cadastrais: há campos obrigatórios em branco ou inválidos.', 422, parsed.error.flatten())
  }
  const model = await loadModel(deps.db, r.modelId)
  const docs = await loadDocuments(deps.db, s.id)
  const check = documentChecklist(model.requirements, docs, deps.now())
  const names = (ids: string[]) => ids.map((id) => model.requirements.find((q) => q.documentTypeId === id)?.name ?? id).join(', ')
  if (check.missing.length) throw new AppError('DOCS_MISSING', `Envie os documentos obrigatórios: ${names(check.missing)}.`, 422)
  if (check.rejected.length) throw new AppError('DOCS_REJECTED', `Envie de novo os documentos reprovados: ${names(check.rejected)}.`, 422)

  const to = transition(r.status as RequestStatus, 'supplier_submit', 'supplier', { requesterId: r.requesterId })
  const now = deps.now()
  await deps.db
    .update(suppliers)
    .set({ profile: parsed.data as unknown as Record<string, unknown>, email: parsed.data.email, updatedAt: now })
    .where(eq(suppliers.id, s.id))
  await deps.db.update(requests).set({ status: to, supplierSubmittedAt: now, updatedAt: now }).where(eq(requests.id, r.id))
  await recordEvent(deps.db, { requestId: r.id, actorId: null, actorLabel: 'Fornecedor', kind: 'supplier_submit', fromStatus: r.status as RequestStatus, toStatus: to })
  await notifyPermission(deps.db, deps.mailer, PERMISSIONS.requestAnalyze, {
    title: `Fornecedor enviou o cadastro — nº ${r.number}`,
    lines: [`${parsed.data.legalName} (${formatDocument(s.document)}) enviou dados e documentos para análise.`],
    path: `/solicitacoes/${r.id}`,
    requestId: r.id,
  })
  return portalData(deps, inviteId)
}

export async function portalDownload(deps: PortalDeps, inviteId: string, documentId: string) {
  const { supplier: s } = await inviteById(deps, inviteId)
  const found = await readDocumentFile(deps.db, deps.storage, documentId, s.id)
  if (!found) throw notFound('Documento')
  return found
}
