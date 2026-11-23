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
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { UauPreviewDTO } from '../../../shared/contracts'
import { formatDocument } from '../../../shared/domain/document-number'
import { PERMISSIONS } from '../../../shared/domain/roles'
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
import { approvalBlockers, getRequest } from './requests'
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
    if (docs.length) {
      // Pessoa nova: o código só existe depois do GravarPessoa
      const folder = duplicate.codPes
        ? await resolveAttachmentFolder(deps, duplicate.codPes, folderName(detail.supplier))
        : joinFolder(uauAttachmentFolder(), supplierFolderName(0, folderName(detail.supplier)).replace(/^0 - /, '<código> - '))
      const body = buildAttachBody(
        docs.map((d) => ({ fileName: d.fileName, extension: EXT[d.mime] ?? 'pdf', base64: `<${d.size} bytes>` })),
        { codPes: codPlaceholder, folder, user: uauUser(), company: uauCompany() },
      )
      steps.push({ route: UAU_ROUTES.attachFiles, description: `Anexa ${docs.length} documento(s) aprovado(s)`, body })
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
  if (dup.error) throw new AppError('UAU_CHECK_FAILED', `Não foi possível confirmar se o fornecedor já existe no UAU: ${dup.error}`, 502)
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
  const docs = await approvedDocuments(deps, detail.supplier.id)
  const toAttach = docs.filter((d) => !d.uauAttachedAt)
  if (toAttach.length) {
    try {
      const files = await Promise.all(
        toAttach.map(async (d) => ({ fileName: d.fileName, extension: EXT[d.mime] ?? 'pdf', base64: (await deps.storage.get(d.storageKey)).toString('base64') })),
      )
      const r = await deps.uau.call(
        UAU_ROUTES.attachFiles,
        buildAttachBody(files, {
          codPes: codPes ?? 0,
          folder: codPes ? await resolveAttachmentFolder(deps, codPes, folderName(detail.supplier)) : joinFolder(uauAttachmentFolder(), '<simulação>'),
          user,
          company: uauCompany(),
        }),
      )
      calls.push({ ...r, data: r.simulated ? undefined : r.data, description: `Anexos (${toAttach.length})` })
      if (r.ok && !r.simulated) {
        await deps.db.update(documents).set({ uauAttachedAt: now }).where(inArray(documents.id, toAttach.map((d) => d.id)))
      } else if (!r.simulated) warnings.push(`Anexos: HTTP ${r.status}${uauMessage(r.data)}`)
    } catch (err) {
      warnings.push(`Anexos: ${err instanceof Error ? err.message : 'falhou'}`)
    }
  }

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
    title: `Fornecedor homologado — solicitação nº ${detail.number}`,
    lines: [`${detail.supplier.legalName} (${formatDocument(detail.supplier.document)}) foi homologado${simulated ? ' (simulação)' : ` e cadastrado no UAU com o código ${codPes}`}.`],
    path: `/solicitacoes/${requestId}`,
    requestId,
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
