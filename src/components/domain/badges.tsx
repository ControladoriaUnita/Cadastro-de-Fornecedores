/**
 * Selos de situação usados em todas as telas (cores semânticas da identidade).
 */
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert, ShieldCheck, ShieldQuestion, XCircle } from 'lucide-react'
import { EXPIRY_LABELS, REVIEW_LABELS, type ExpiryState, type ReviewStatus } from '@shared/domain/documents'
import { STATUS_LABELS, type RequestStatus } from '@shared/domain/request/status'
import { RISK_LEVEL_LABELS, type RiskLevel } from '@shared/domain/risk'
import { SUPPLIER_STATUS_LABELS, type SupplierStatus } from '@shared/domain/supplier'
import { Badge, type Tone } from '@/components/ui'

export const STATUS_TONES: Record<RequestStatus, Tone> = {
  solicitado: 'neutral',
  aguardando_fornecedor: 'info',
  em_analise: 'primary',
  pendencias: 'warning',
  aguardando_aprovacao: 'primary',
  gravado_uau: 'success',
  recusado: 'error',
  cancelado: 'neutral',
}

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>
}

const RISK_TONES: Record<RiskLevel, Tone> = { baixo: 'success', medio: 'warning', alto: 'error', nao_avaliado: 'neutral' }
const RISK_ICONS = { baixo: ShieldCheck, medio: ShieldAlert, alto: ShieldAlert, nao_avaliado: ShieldQuestion }

export function RiskBadge({ level, compact }: { level: RiskLevel; compact?: boolean }) {
  const Icon = RISK_ICONS[level]
  return (
    <Badge tone={RISK_TONES[level]} icon={<Icon className="size-3.5" aria-hidden />} title={`Risco ${RISK_LEVEL_LABELS[level].toLowerCase()}`}>
      {compact ? RISK_LEVEL_LABELS[level] : `Risco ${RISK_LEVEL_LABELS[level].toLowerCase()}`}
    </Badge>
  )
}

const SUPPLIER_TONES: Record<SupplierStatus, Tone> = { em_cadastro: 'info', homologado: 'success', bloqueado: 'error', inativo: 'neutral' }

export function SupplierStatusBadge({ status }: { status: SupplierStatus }) {
  return <Badge tone={SUPPLIER_TONES[status]}>{SUPPLIER_STATUS_LABELS[status]}</Badge>
}

const REVIEW_TONES: Record<ReviewStatus, Tone> = { pendente: 'warning', aprovado: 'success', reprovado: 'error' }
const REVIEW_ICONS = { pendente: Clock, aprovado: CheckCircle2, reprovado: XCircle }

export function ReviewBadge({ status }: { status: ReviewStatus }) {
  const Icon = REVIEW_ICONS[status]
  return (
    <Badge tone={REVIEW_TONES[status]} icon={<Icon className="size-3.5" aria-hidden />}>
      {REVIEW_LABELS[status]}
    </Badge>
  )
}

const EXPIRY_TONES: Record<ExpiryState, Tone> = { sem_validade: 'neutral', valido: 'success', vencendo: 'warning', vencido: 'error' }

export function ExpiryBadge({ state }: { state: ExpiryState }) {
  if (state === 'sem_validade') return null
  return (
    <Badge tone={EXPIRY_TONES[state]} icon={state === 'valido' ? undefined : <AlertTriangle className="size-3.5" aria-hidden />}>
      {EXPIRY_LABELS[state]}
    </Badge>
  )
}
