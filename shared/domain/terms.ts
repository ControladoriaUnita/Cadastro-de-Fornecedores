/**
 * Vocabulário de cada módulo. No Fornecedores/PJ fala-se de "fornecedor" e "homologação";
 * no Pessoas Físicas/PF, de "pessoa" e "cadastro" — sem menção a fornecedor.
 * As constantes antigas (STATUS_LABELS, ACTIONS…) continuam valendo para o PJ.
 */
import type { Module } from './modules'
import { STATUS_DESCRIPTIONS, STATUS_LABELS, type RequestStatus } from './request/status'
import { ACTIONS, type RequestAction } from './request/workflow'
import { SUPPLIER_STATUS_LABELS, type SupplierStatus } from './supplier'

export interface ModuleTerms {
  /** "fornecedor" / "pessoa" */
  person: string
  /** "o fornecedor" / "a pessoa" */
  thePerson: string
  /** "O fornecedor" / "A pessoa" */
  ThePerson: string
  /** "do fornecedor" / "da pessoa" */
  ofPerson: string
  /** "ao fornecedor" / "à pessoa" */
  toPerson: string
  /** "pelo fornecedor" / "pela pessoa" */
  byPerson: string
  /** "cadastro de fornecedor" / "cadastro de pessoa física" */
  registration: string
  /** Título da área nos e-mails */
  area: string
}

export const TERMS: Record<Module, ModuleTerms> = {
  pj: {
    person: 'fornecedor',
    thePerson: 'o fornecedor',
    ThePerson: 'O fornecedor',
    ofPerson: 'do fornecedor',
    toPerson: 'ao fornecedor',
    byPerson: 'pelo fornecedor',
    registration: 'cadastro de fornecedor',
    area: 'Fornecedores',
  },
  pf: {
    person: 'pessoa',
    thePerson: 'a pessoa',
    ThePerson: 'A pessoa',
    ofPerson: 'da pessoa',
    toPerson: 'à pessoa',
    byPerson: 'pela pessoa',
    registration: 'cadastro de pessoa física',
    area: 'Pessoas Físicas',
  },
}

export const terms = (module: Module | null | undefined): ModuleTerms => TERMS[module ?? 'pj']

const PF_STATUS_LABELS: Partial<Record<RequestStatus, string>> = {
  aguardando_fornecedor: 'Aguardando a pessoa',
}

const PF_STATUS_DESCRIPTIONS: Record<RequestStatus, string> = {
  solicitado: 'Pedido aberto; ainda não foi enviado o convite à pessoa.',
  aguardando_fornecedor: 'Convite enviado; a pessoa está preenchendo dados e documentos.',
  em_analise: 'A equipe confere dados e documentos.',
  pendencias: 'Devolvido à pessoa para corrigir ou completar.',
  aguardando_aprovacao: 'Pronto para aprovar e gravar no UAU.',
  gravado_uau: 'Pessoa cadastrada no UAU.',
  recusado: 'Cadastro recusado.',
  cancelado: 'Cancelado por quem pediu.',
}

const PF_SUPPLIER_STATUS_LABELS: Record<SupplierStatus, string> = {
  em_cadastro: 'Em cadastro',
  homologado: 'Cadastrada',
  bloqueado: 'Bloqueada',
  inativo: 'Inativa',
}

const PF_ACTION_LABELS: Partial<Record<RequestAction, string>> = {
  invite: 'Enviar convite à pessoa',
}

const isPf = (m: Module | null | undefined) => m === 'pf'

export const statusLabel = (s: RequestStatus, m?: Module | null) => (isPf(m) ? PF_STATUS_LABELS[s] : undefined) ?? STATUS_LABELS[s]
export const statusDescription = (s: RequestStatus, m?: Module | null) => (isPf(m) ? PF_STATUS_DESCRIPTIONS[s] : STATUS_DESCRIPTIONS[s])
export const supplierStatusLabel = (s: SupplierStatus, m?: Module | null) => (isPf(m) ? PF_SUPPLIER_STATUS_LABELS[s] : SUPPLIER_STATUS_LABELS[s])
export const actionLabel = (a: RequestAction, m?: Module | null) => (isPf(m) ? PF_ACTION_LABELS[a] : undefined) ?? ACTIONS[a].label
