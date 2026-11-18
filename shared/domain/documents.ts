/**
 * Documentos do fornecedor: situação da conferência e vencimento.
 */

export const REVIEW_STATUSES = ['pendente', 'aprovado', 'reprovado'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

export const REVIEW_LABELS: Record<ReviewStatus, string> = {
  pendente: 'A conferir',
  aprovado: 'Aprovado',
  reprovado: 'Reprovado',
}

/** Dias antes do vencimento em que o documento passa a "vencendo". */
export const EXPIRY_WARNING_DAYS = 30

export type ExpiryState = 'sem_validade' | 'valido' | 'vencendo' | 'vencido'

export function expiryState(expiresAt: string | null, today = new Date()): ExpiryState {
  if (!expiresAt) return 'sem_validade'
  const end = new Date(`${expiresAt.slice(0, 10)}T23:59:59`)
  const days = Math.floor((end.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return 'vencido'
  if (days <= EXPIRY_WARNING_DAYS) return 'vencendo'
  return 'valido'
}

export const EXPIRY_LABELS: Record<ExpiryState, string> = {
  sem_validade: 'Sem validade',
  valido: 'Válido',
  vencendo: 'Vencendo',
  vencido: 'Vencido',
}

/** Tipos aceitos no envio (PDF e imagens). */
export const ACCEPTED_MIME = ['application/pdf', 'image/png', 'image/jpeg'] as const
/** 4 MB: as funções da Vercel aceitam no máximo 4,5 MB por requisição. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024

export interface RequirementLike {
  documentTypeId: string
  required: boolean
}
export interface DocumentLike {
  documentTypeId: string
  reviewStatus: ReviewStatus
  expiresAt: string | null
}

/**
 * Situação do conjunto de documentos frente ao modelo:
 *  - missing: obrigatórios sem nenhum arquivo enviado
 *  - pendingReview: obrigatórios ainda não conferidos
 *  - rejected: obrigatórios cujo último envio foi reprovado
 *  - expired: obrigatórios vencidos
 */
export function documentChecklist(requirements: RequirementLike[], documents: DocumentLike[], today = new Date()) {
  const latest = new Map<string, DocumentLike>()
  for (const d of documents) latest.set(d.documentTypeId, d) // documentos chegam ordenados do mais antigo ao mais novo
  const result = { missing: [] as string[], pendingReview: [] as string[], rejected: [] as string[], expired: [] as string[] }
  for (const r of requirements.filter((x) => x.required)) {
    const d = latest.get(r.documentTypeId)
    if (!d) result.missing.push(r.documentTypeId)
    else if (d.reviewStatus === 'reprovado') result.rejected.push(r.documentTypeId)
    else if (d.reviewStatus === 'pendente') result.pendingReview.push(r.documentTypeId)
    else if (expiryState(d.expiresAt, today) === 'vencido') result.expired.push(r.documentTypeId)
  }
  const complete = !result.missing.length && !result.pendingReview.length && !result.rejected.length && !result.expired.length
  return { ...result, complete }
}
