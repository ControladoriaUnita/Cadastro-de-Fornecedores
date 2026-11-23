/**
 * Tela de validação: prévia exata do que vai para o UAU e a gravação.
 *
 * Ordem da gravação:
 *  1. consulta CPF/CNPJ no UAU — se já existir, usa o código existente (não cria pessoa nova)
 *  2. GravarPessoa → código da pessoa
 *  3. ManterTelefone, GravarContaBancaria (avisos se falharem; a pessoa já existe)
 *  4. Anexos: documentos aprovados → AnexarArquivosBase64Request, chave "Pessoas <código>",
 *     pasta "<UAU_PASTA_ANEXOS>\<código> - <NOME>" (reaproveita a pasta se já existir)
 * Com UAU_GRAVACAO=simulacao nada é gravado: o resultado fica marcado como simulado.
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { RequestDetailDTO, UauPreviewDTO } from '../../../shared/contracts'
import { formatDocument } from '../../../shared/domain/document-number'
import { PERMISSIONS } from '../../../shared/domain/roles'
import { terms } from '../../../shared/domain/terms'
import { supplierProfileSchema, type SupplierProfile } from '../../../shared/domain/supplier'
import {
  buildAttachBody,
  buildBankBody,
  buildPhoneBody,
  buildSavePersonBody,
  extractPersonCode,
  findSupplierFolder,
  joinFolder,
  supplierFolderName,
  UAU_ROUTES,
} from '../../../shared/domain/uau-payload'
import { schema } from '../../infrastructure/db/client'
import { uauAttachmentFolder, uauCompany, uauUser } from '../../infrastructure/uau'
import { AppError, requirePermission } from '../context'
import { notifyAddresses } from '../notifications'
import type { UauCallResult, UseCaseDeps } from '../ports'
import { recordEvent } from '../shared'
import { qualificationPdf } from './qualification'
import { approvalBlockers, getRequest } from './requests'
import { getSupplier } from './suppliers'
import { checkUauPerson } from './uau-people'

const { documents, requests, suppliers, users } = schema

const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' }

/**
 * Pasta dos anexos: <UAU_PASTA_ANEXOS>\<código> - <NOME>.
 * Se o fornecedor já tem pasta lá (cadastros antigos), reaproveita a existente.
 */
async function resolveAttachmentFolder(deps: UseCaseDeps, codPes: number, name: string): Promise<string> {
  const base = uauAttachmentFolder()
  try {
    const res = await deps.uau.call(UAU_ROUTES.listFolders, { Caminho: base, Origem: 1 })
    const names = Array.isArray(res.data)
      ? (res.data as { Nome?: unknown; Tipo?: unknown }[]).filter((d) => d.Tipo === 'Diretorio' && typeof d.Nome === 'string').map((d) => d.Nome as string)
      : []
    const existing = findSupplierFolder(names, codPes)
    if (existing) return joinFolder(base, existing)
  } catch {
    // sem a listagem, cria a pasta no padrão
  }
  return joinFolder(base, supplierFolderName(codPes, name))
}

const folderName = (s: { tradeName: string | null; legalName: string }) => s.tradeName || s.legalName

async function approvedDocuments(deps: UseCaseDeps, supplierId: string) {
  return deps.db
    .select()
    .from(documents)
    .where(and(eq(documents.supplierId, supplierId), eq(documents.reviewStatus, 'aprovado'), isNull(documents.replacedAt)))
}

export async function uauPreview(deps: UseCaseDeps, requestId: string): Promise<UauPreviewDTO & { blockers: string[] }> {
  requirePermission(deps.ctx.actor, PERMISSIONS.requestAnalyze)
  const detail = await getRequest(deps, requestId)
  const parsed = supplierProfileSchema.safeParse({ ...detail.supplier.profile, document: detail.supplier.document })
  const duplicate = detail.supplier.uauCodPes
    ? { found: true, codPes: detail.supplier.uauCodPes, name: detail.supplier.legalName, error: null }
    : await checkUauPerson(deps.uau, detail.supplier.document)
  const docs = await approvedDocuments(deps, detail.supplier.id)
  const steps: UauPreviewDTO['steps'] = []
  const codPlaceholder = duplicate.codPes ?? 0
  if (parsed.success) {
    const p = parsed.data
    if (!duplicate.found) {
      steps.push({ route: UAU_ROUTES.savePerson, description: 'Cria a pessoa (confirmada e ativa)', body: buildSavePersonBody(p, { user: uauUser(), now: deps.ctx.now(), foundedAt: await foundedAt(deps, detail.supplier) }) })
      steps.push({ route: UAU_ROUTES.savePhone, description: 'Telefone principal', body: buildPhoneBody(p, codPlaceholder) })
      const bank = buildBankBody(p, codPlaceholder)
      if (bank) steps.push({ route: UAU_ROUTES.saveBank, description: 'Conta bancária padrão', body: bank })
    }
    const withForm = detail.qualification.complete && !detail.qualification.uauAttachedAt
    if (docs.length || withForm) {
      // Pessoa nova: o código só existe depois do GravarPessoa
      const folder = duplicate.codPes
        ? await resolveAttachmentFolder(deps, duplicate.codPes, folderName(detail.supplier))
        : joinFolder(uauAttachmentFolder(), supplierFolderName(0, folderName(detail.supplier)).replace(/^0 - /, '<código> - '))
      const body = buildAttachBody(
        [
          ...docs.map((d) => ({ fileName: d.fileName, extension: EXT[d.mime] ?? 'pdf', base64: `<${d.size} bytes>` })),
          ...(withForm ? [{ fileName: qualificationFileName(detail.number), extension: 'pdf', base64: '<PDF gerado na gravação>' }] : []),
        ],
        { codPes: codPlaceholder, folder, user: uauUser(), company: uauCompany() },
      )
      steps.push({ route: UAU_ROUTES.attachFiles, description: `Anexa ${docs.length} documento(s) aprovado(s)${withForm ? ' e o formulário de qualificação (PDF)' : ''}`, body })
    }
  }
  const typeNames = new Map(detail.documents.map((d) => [d.id, d.documentTypeName]))
  return {
    writeEnabled: deps.uau.writeEnabled,
    duplicate,
    profileErrors: parsed.success ? [] : parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    steps,
    attachments: docs.map((d) => ({ documentId: d.id, fileName: d.fileName, documentTypeName: typeNames.get(d.id) ?? '' })),
    blockers: approvalBlockers(detail),
  }
}

export async function approveRequest(deps: UseCaseDeps, requestId: string) {
  requirePermission(deps.ctx.actor, PERMISSIONS.requestApprove)
  const detail = await getRequest(deps, requestId)
  if (detail.status !== 'aguardando_aprovacao') throw new AppError('INVALID_TRANSITION', 'A solicitação não está aguardando aprovação.', 409)
  const blockers = approvalBlockers(detail)
  if (blockers.length) throw new AppError('NOT_READY', blockers.join(' '), 422, { blockers })
  const profile: SupplierProfile = supplierProfileSchema.parse({ ...detail.supplier.profile, document: detail.supplier.document })
  const now = deps.ctx.now()
  const user = uauUser()
  const calls: (Omit<UauCallResult, 'data'> & { data?: unknown; description: string })[] = []
  const warnings: string[] = []
  const simulated = !deps.uau.writeEnabled

  // 1) duplicidade
  const dup = detail.supplier.uauCodPes
    ? { found: true, codPes: detail.supplier.uauCodPes, name: null, error: null }
    : await checkUauPerson(deps.uau, detail.supplier.document)
  if (dup.error) throw new AppError('UAU_CHECK_FAILED', `Não foi possível confirmar se ${terms(deps.ctx.module).thePerson} já existe no UAU: ${dup.error}`, 502)
  let codPes: number | null = dup.codPes

  // 2) pessoa, telefone e conta
  if (!dup.found) {
    const res = await deps.uau.call(UAU_ROUTES.savePerson, buildSavePersonBody(profile, { user, now, foundedAt: await foundedAt(deps, detail.supplier) }))
    calls.push({ ...res, description: 'GravarPessoa' })
    if (!res.simulated) {
      if (!res.ok) {
        await recordEvent(deps.db, {
          requestId,
          actorId: deps.ctx.actor.id,
          actorLabel: deps.ctx.actor.fullName,
          kind: 'uau_error',
          comment: `GravarPessoa HTTP ${res.status}`,
          payload: { response: res.data as Record<string, unknown> },
        })
        throw new AppError('UAU_SAVE_FAILED', `O UAU recusou o cadastro (HTTP ${res.status}). Veja o detalhe no histórico.`, 502, res.data)
      }
      codPes = extractPersonCode(res.data)
      if (!codPes) {
        // A pessoa pode ter sido criada mesmo sem o código na resposta: confirma pela consulta
        const again = await checkUauPerson(deps.uau, detail.supplier.document)
        codPes = again.codPes
      }
      if (!codPes) throw new AppError('UAU_NO_CODE', 'O UAU aceitou o cadastro mas não devolveu o código da pessoa. Confira no UAU antes de tentar de novo.', 502, res.data)
    }
    const followUps = [
      { route: UAU_ROUTES.savePhone, body: buildPhoneBody(profile, codPes ?? 0), description: 'ManterTelefone' },
      ...(profile.bank ? [{ route: UAU_ROUTES.saveBank, body: buildBankBody(profile, codPes ?? 0), description: 'GravarContaBancaria' }] : []),
    ]
    for (const f of followUps) {
      try {
        const r = await deps.uau.call(f.route, f.body)
        calls.push({ ...r, description: f.description })
        if (!r.ok && !r.simulated) warnings.push(`${f.description}: HTTP ${r.status}`)
      } catch (err) {
        warnings.push(`${f.description}: ${err instanceof Error ? err.message : 'falhou'}`)
      }
    }
  }

  // 3) anexos
  const attach = await attachPendingDocuments(deps, detail, codPes, user, now)
  if (attach.call) calls.push(attach.call)
  if (attach.warning) warnings.push(attach.warning)

  // 4) situação
  const result = {
    simulated,
    codPes,
    linkedExisting: dup.found,
    warnings,
    calls: calls.map((c) => ({ route: c.route, description: c.description, status: c.status, ok: c.ok, ms: c.ms, simulated: !!c.simulated })),
  }
  await deps.db
    .update(suppliers)
    .set({ status: 'homologado', uauCodPes: simulated ? detail.supplier.uauCodPes : codPes, uauSyncedAt: simulated ? null : now, updatedAt: now })
    .where(eq(suppliers.id, detail.supplier.id))
  await deps.db
    .update(requests)
    .set({ status: 'gravado_uau', uauSimulated: simulated, uauResult: result, updatedAt: now, closedAt: now })
    .where(eq(requests.id, requestId))
  await recordEvent(deps.db, {
    requestId,
    actorId: deps.ctx.actor.id,
    actorLabel: deps.ctx.actor.fullName,
    kind: 'approve',
    fromStatus: 'aguardando_aprovacao',
    toStatus: 'gravado_uau',
    comment: simulated ? 'Simulação: nada foi gravado no UAU (UAU_GRAVACAO=simulacao).' : warnings.length ? `Gravado com avisos: ${warnings.join('; ')}` : null,
    payload: result,
  })

  const [requester] = await deps.db.select({ email: users.email }).from(users).where(eq(users.id, detail.requester.id))
  await notifyAddresses(deps.mailer, [requester?.email ?? ''], {
    title: detail.module === 'pf' ? `Pessoa cadastrada — solicitação nº ${detail.number}` : `Fornecedor homologado — solicitação nº ${detail.number}`,
    lines: [
      detail.module === 'pf'
        ? `${detail.supplier.legalName} (${formatDocument(detail.supplier.document)}) foi aprovada${simulated ? ' (simulação)' : ` e cadastrada no UAU com o código ${codPes}`}.`
        : `${detail.supplier.legalName} (${formatDocument(detail.supplier.document)}) foi homologado${simulated ? ' (simulação)' : ` e cadastrado no UAU com o código ${codPes}`}.`,
    ],
    path: `/solicitacoes/${requestId}`,
    requestId,
    module: detail.module,
  })
  return getRequest(deps, requestId)
}

/** Motivo que o UAU devolve na recusa (Descricao/Mensagem), para o histórico. */
function uauMessage(data: unknown): string {
  const first = Array.isArray(data) ? data[0] : data
  if (!first || typeof first !== 'object') return ''
  const o = first as Record<string, unknown>
  const msg = [o.Descricao, o.Mensagem].find((v) => typeof v === 'string' && v.trim())
  return msg ? ` — ${String(msg).replace(/\s+/g, ' ').trim().slice(0, 300)}` : ''
}

/** Data de abertura do CNPJ (campo Fundação no UAU): a guardada na consulta da Receita, ou consulta de novo. */
async function foundedAt(deps: UseCaseDeps, s: { document: string; personKind: string; receita: { dataAbertura: string | null } | null }) {
  if (s.personKind !== 'PJ') return null
  if (s.receita?.dataAbertura) return s.receita.dataAbertura
  const company = await deps.company.find(s.document).catch(() => null)
  return company?.dataAbertura ?? null
}

/**
 * Anexa no UAU os documentos aprovados que ainda não foram (uau_attached_at vazio).
 * Usado na aprovação e no botão "Reenviar anexos ao UAU". Nunca lança: falha vira aviso.
 */
async function attachPendingDocuments(
  deps: UseCaseDeps,
  detail: RequestDetailDTO,
  codPes: number | null,
  user: string,
  now: Date,
): Promise<{ count: number; ok: boolean; call?: Omit<UauCallResult, 'data'> & { data?: unknown; description: string }; warning?: string }> {
  const supplier = detail.supplier
  const toAttach = (await approvedDocuments(deps, supplier.id)).filter((d) => !d.uauAttachedAt)
  // O formulário de qualificação vai junto, em PDF, uma vez só
  const withForm = detail.qualification.complete && !detail.qualification.uauAttachedAt
  const count = toAttach.length + (withForm ? 1 : 0)
  if (!count) return { count: 0, ok: true }
  try {
    const files = await Promise.all(
      toAttach.map(async (d) => ({ fileName: d.fileName, extension: EXT[d.mime] ?? 'pdf', base64: (await deps.storage.get(d.storageKey)).toString('base64') })),
    )
    if (withForm) {
      const pdf = await qualificationPdf({ number: detail.number, supplierName: supplier.legalName, document: supplier.document, codPes, qualification: detail.qualification, generatedAt: now })
      files.push({ fileName: qualificationFileName(detail.number), extension: 'pdf', base64: pdf.toString('base64') })
    }
    const r = await deps.uau.call(
      UAU_ROUTES.attachFiles,
      buildAttachBody(files, {
        codPes: codPes ?? 0,
        folder: codPes ? await resolveAttachmentFolder(deps, codPes, folderName(supplier)) : joinFolder(uauAttachmentFolder(), '<simulação>'),
        user,
        company: uauCompany(),
      }),
    )
    const call = { ...r, data: r.simulated ? undefined : r.data, description: `Anexos (${count})` }
    if (r.ok && !r.simulated) {
      if (toAttach.length) await deps.db.update(documents).set({ uauAttachedAt: now }).where(inArray(documents.id, toAttach.map((d) => d.id)))
      if (withForm) await deps.db.update(requests).set({ qualificationUauAt: now }).where(eq(requests.id, detail.id))
      return { count, ok: true, call }
    }
    return { count, ok: !!r.simulated, call, warning: r.simulated ? undefined : `Anexos: HTTP ${r.status}${uauMessage(r.data)}` }
  } catch (err) {
    return { count, ok: false, warning: `Anexos: ${err instanceof Error ? err.message : 'falhou'}` }
  }
}

/**
 * Botão "Reenviar anexos ao UAU": para solicitação já gravada no UAU de verdade, manda os
 * documentos aprovados que ainda não foram anexados (por falha na gravação ou aprovados depois).
 */
export async function resendAttachments(deps: UseCaseDeps, requestId: string) {
  requirePermission(deps.ctx.actor, PERMISSIONS.requestApprove)
  const detail = await getRequest(deps, requestId)
  if (detail.status !== 'gravado_uau' || detail.uauSimulated) throw new AppError('NOT_IN_UAU', 'Só dá para reenviar anexos de solicitação já gravada no UAU.', 409)
  const codPes = detail.supplier.uauCodPes
  if (!codPes) throw new AppError('NO_UAU_CODE', `${terms(detail.module).ThePerson} está sem o código da pessoa no UAU.`, 409)
  if (!deps.uau.writeEnabled) throw new AppError('UAU_SIMULATION', 'A gravação no UAU está em simulação (UAU_GRAVACAO=simulacao).', 409)

  const res = await attachPendingDocuments(deps, detail, codPes, uauUser(), deps.ctx.now())
  if (!res.count) throw new AppError('NOTHING_PENDING', 'Todos os documentos aprovados e o formulário de qualificação já estão anexados no UAU.', 409)
  await recordEvent(deps.db, {
    requestId,
    actorId: deps.ctx.actor.id,
    actorLabel: deps.ctx.actor.fullName,
    kind: res.ok ? 'uau_attach' : 'uau_error',
    comment: res.ok ? `${res.count} anexo(s) enviados ao UAU (pessoa ${codPes}).` : res.warning,
  })
  if (!res.ok) throw new AppError('UAU_ATTACH_FAILED', `O UAU recusou os anexos. ${res.warning ?? ''}`.trim(), 502)
  return getRequest(deps, requestId)
}

/**
 * Botão "Reenviar anexos ao UAU" na ficha do fornecedor: percorre as solicitações já gravadas no
 * UAU (mais recente primeiro) e manda os documentos aprovados e os formulários que faltam.
 */
export async function resendSupplierAttachments(deps: UseCaseDeps, supplierId: string) {
  requirePermission(deps.ctx.actor, PERMISSIONS.requestApprove)
  const [s] = await deps.db.select({ uauCodPes: suppliers.uauCodPes }).from(suppliers).where(eq(suppliers.id, supplierId))
  const t = terms(deps.ctx.module)
  if (!s) throw new AppError('NOT_FOUND', 'Cadastro não encontrado.', 404)
  if (!s.uauCodPes) throw new AppError('NO_UAU_CODE', `${t.ThePerson} está sem o código da pessoa no UAU.`, 409)
  if (!deps.uau.writeEnabled) throw new AppError('UAU_SIMULATION', 'A gravação no UAU está em simulação (UAU_GRAVACAO=simulacao).', 409)
  const inUau = await deps.db
    .select({ id: requests.id })
    .from(requests)
    .where(and(eq(requests.supplierId, supplierId), eq(requests.status, 'gravado_uau'), eq(requests.uauSimulated, false)))
    .orderBy(desc(requests.closedAt))
  if (!inUau.length) throw new AppError('NOT_IN_UAU', `${deps.ctx.module === 'pf' ? 'Esta pessoa' : 'Este fornecedor'} não tem solicitação gravada no UAU pelo app.`, 409)

  let total = 0
  for (const { id } of inUau) {
    const detail = await getRequest(deps, id)
    const res = await attachPendingDocuments(deps, detail, s.uauCodPes, uauUser(), deps.ctx.now())
    if (!res.count) continue
    total += res.count
    await recordEvent(deps.db, {
      requestId: id,
      actorId: deps.ctx.actor.id,
      actorLabel: deps.ctx.actor.fullName,
      kind: res.ok ? 'uau_attach' : 'uau_error',
      comment: res.ok ? `${res.count} anexo(s) enviados ao UAU pela ficha ${t.ofPerson} (pessoa ${s.uauCodPes}).` : res.warning,
    })
    if (!res.ok) throw new AppError('UAU_ATTACH_FAILED', `O UAU recusou os anexos. ${res.warning ?? ''}`.trim(), 502)
  }
  if (!total) throw new AppError('NOTHING_PENDING', 'Todos os documentos aprovados e os formulários de qualificação já estão anexados no UAU.', 409)
  return getSupplier(deps, supplierId)
}

const qualificationFileName = (n: number) => `Formulario de qualificacao - solicitacao ${n}.pdf`
