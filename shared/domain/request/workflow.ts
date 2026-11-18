/**
 * Máquina de estados da solicitação: quais ações existem em cada situação e quem pode executá-las.
 * A API aplica estas regras; a tela usa as mesmas para mostrar só os botões cabíveis.
 */
import { PERMISSIONS, type Permission } from '../roles'
import type { RequestStatus } from './status'

export type RequestAction =
  | 'invite' // envia (ou reenvia) o link ao fornecedor
  | 'cancel'
  | 'reject'
  | 'supplier_submit' // fornecedor concluiu o envio (feito pelo portal)
  | 'request_changes' // devolve ao fornecedor com pendências
  | 'send_to_approval'
  | 'return_to_analysis'
  | 'approve'

interface ActionRule {
  from: RequestStatus[]
  to: RequestStatus | null // null = não muda a situação
  permission: Permission | 'supplier' | 'owner_or_analyze'
  commentRequired?: boolean
  label: string
}

const P = PERMISSIONS

export const ACTIONS: Record<RequestAction, ActionRule> = {
  invite: { from: ['solicitado', 'aguardando_fornecedor', 'pendencias'], to: 'aguardando_fornecedor', permission: P.requestAnalyze, label: 'Enviar convite ao fornecedor' },
  cancel: { from: ['solicitado', 'aguardando_fornecedor'], to: 'cancelado', permission: 'owner_or_analyze', label: 'Cancelar solicitação' },
  reject: {
    from: ['solicitado', 'aguardando_fornecedor', 'em_analise', 'pendencias', 'aguardando_aprovacao'],
    to: 'recusado',
    permission: P.requestAnalyze,
    commentRequired: true,
    label: 'Recusar',
  },
  supplier_submit: { from: ['aguardando_fornecedor', 'pendencias'], to: 'em_analise', permission: 'supplier', label: 'Enviar para análise' },
  request_changes: { from: ['em_analise'], to: 'pendencias', permission: P.requestAnalyze, commentRequired: true, label: 'Devolver com pendências' },
  send_to_approval: { from: ['em_analise'], to: 'aguardando_aprovacao', permission: P.requestAnalyze, label: 'Enviar para aprovação' },
  return_to_analysis: { from: ['aguardando_aprovacao'], to: 'em_analise', permission: P.requestApprove, commentRequired: true, label: 'Devolver para análise' },
  approve: { from: ['aguardando_aprovacao'], to: 'gravado_uau', permission: P.requestApprove, label: 'Aprovar e gravar no UAU' },
}

export class WorkflowError extends Error {
  constructor(
    readonly code: 'INVALID_TRANSITION' | 'FORBIDDEN' | 'COMMENT_REQUIRED',
    message: string,
  ) {
    super(message)
    this.name = 'WorkflowError'
  }
}

export interface ActorLike {
  id: string
  permissions: readonly string[]
}

function allowed(rule: ActionRule, actor: ActorLike | 'supplier', requesterId: string | null): boolean {
  if (rule.permission === 'supplier') return actor === 'supplier'
  if (actor === 'supplier') return false
  if (rule.permission === 'owner_or_analyze') return actor.id === requesterId || actor.permissions.includes(P.requestAnalyze)
  return actor.permissions.includes(rule.permission)
}

/** Ações disponíveis para este usuário nesta situação. */
export function availableActions(status: RequestStatus, actor: ActorLike, requesterId: string | null): RequestAction[] {
  return (Object.keys(ACTIONS) as RequestAction[]).filter((a) => {
    const rule = ACTIONS[a]
    return rule.from.includes(status) && allowed(rule, actor, requesterId)
  })
}

/** Valida a transição e devolve a nova situação. Lança WorkflowError se não couber. */
export function transition(
  status: RequestStatus,
  action: RequestAction,
  actor: ActorLike | 'supplier',
  opts: { requesterId: string | null; comment?: string | null },
): RequestStatus {
  const rule = ACTIONS[action]
  if (!rule.from.includes(status)) {
    throw new WorkflowError('INVALID_TRANSITION', `"${rule.label}" não está disponível nesta etapa da solicitação.`)
  }
  if (!allowed(rule, actor, opts.requesterId)) throw new WorkflowError('FORBIDDEN', 'Seu perfil não pode executar esta ação.')
  if (rule.commentRequired && !opts.comment?.trim()) throw new WorkflowError('COMMENT_REQUIRED', 'Informe o motivo.')
  return rule.to ?? status
}
