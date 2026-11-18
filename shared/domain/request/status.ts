/**
 * Situações da solicitação de cadastro (colunas do kanban).
 *
 *  solicitado → aguardando_fornecedor → em_analise ⇄ pendencias → aguardando_aprovacao → gravado_uau
 *  (recusado e cancelado encerram em qualquer etapa aberta)
 */

export const REQUEST_STATUSES = [
  'solicitado',
  'aguardando_fornecedor',
  'em_analise',
  'pendencias',
  'aguardando_aprovacao',
  'gravado_uau',
  'recusado',
  'cancelado',
] as const

export type RequestStatus = (typeof REQUEST_STATUSES)[number]

export const STATUS_LABELS: Record<RequestStatus, string> = {
  solicitado: 'Solicitado',
  aguardando_fornecedor: 'Aguardando fornecedor',
  em_analise: 'Em análise',
  pendencias: 'Pendências',
  aguardando_aprovacao: 'Aguardando aprovação',
  gravado_uau: 'Gravado no UAU',
  recusado: 'Recusado',
  cancelado: 'Cancelado',
}

export const STATUS_DESCRIPTIONS: Record<RequestStatus, string> = {
  solicitado: 'Pedido aberto; suprimentos ainda não convidou o fornecedor.',
  aguardando_fornecedor: 'Convite enviado; o fornecedor está preenchendo dados e documentos.',
  em_analise: 'Suprimentos confere documentos e risco.',
  pendencias: 'Devolvido ao fornecedor para corrigir ou completar.',
  aguardando_aprovacao: 'Pronto para homologar e gravar no UAU.',
  gravado_uau: 'Fornecedor homologado e cadastrado no UAU.',
  recusado: 'Cadastro recusado.',
  cancelado: 'Cancelado por quem pediu.',
}

/** Colunas do kanban (encerrados ficam numa coluna recolhida). */
export const KANBAN_COLUMNS: RequestStatus[] = ['solicitado', 'aguardando_fornecedor', 'em_analise', 'pendencias', 'aguardando_aprovacao', 'gravado_uau']

export const CLOSED_STATUSES: RequestStatus[] = ['gravado_uau', 'recusado', 'cancelado']

export const isOpen = (s: RequestStatus) => !CLOSED_STATUSES.includes(s)

/** Situações em que o fornecedor pode editar pelo link. */
export const SUPPLIER_CAN_EDIT: RequestStatus[] = ['aguardando_fornecedor', 'pendencias']

export const URGENCIES = ['normal', 'alta'] as const
export type Urgency = (typeof URGENCIES)[number]
export const URGENCY_LABELS: Record<Urgency, string> = { normal: 'Normal', alta: 'Alta' }
