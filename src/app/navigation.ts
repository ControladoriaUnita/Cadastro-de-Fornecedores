/**
 * Menu principal e rotas. Para criar uma tela nova: rota em App.tsx + item aqui.
 *
 * Dois módulos com gestão própria (cargos marcam os módulos no Painel dev):
 *   Fornecedores/PJ  → endereços que já existiam (/solicitacoes, /fornecedores, /validacao…)
 *   Pessoas Físicas/PF → mesmos fluxos em /pf/...
 * As telas de detalhe (/solicitacoes/:id, /validacao/:id, /fornecedores/:id) servem aos dois:
 * o módulo vem do documento (CNPJ/CPF). Assim os links dos e-mails continuam valendo.
 */
import type { Module } from '@shared/domain/modules'
import { PERMISSIONS, type Permission } from '@shared/domain/roles'

export const PATHS = {
  /** Tela inicial: escolha do módulo */
  home: '/',
  // Fornecedores/PJ
  pjDashboard: '/painel',
  requests: '/solicitacoes',
  newRequest: '/solicitacoes/nova',
  request: (id: string) => `/solicitacoes/${id}`,
  evaluate: '/avaliar',
  suppliers: '/fornecedores',
  supplier: (id: string) => `/fornecedores/${id}`,
  validation: '/validacao',
  validate: (id: string) => `/validacao/${id}`,
  models: '/modelos',
  // Pessoas Físicas/PF
  pfDashboard: '/pf',
  pfRequests: '/pf/solicitacoes',
  pfNewRequest: '/pf/solicitacoes/nova',
  pfPeople: '/pf/pessoas',
  pfValidation: '/pf/validacao',
  pfModels: '/pf/modelos',
  // Painel dev de cada módulo
  dev: '/dev',
  pfDev: '/pf/dev',
} as const

/** Endereços de lista de cada módulo (as telas recebem o módulo e usam estes caminhos). */
export const MODULE_PATHS: Record<Module, { dashboard: string; requests: string; newRequest: string; base: string; validation: string; models: string; dev: string }> = {
  pj: { dashboard: PATHS.pjDashboard, requests: PATHS.requests, newRequest: PATHS.newRequest, base: PATHS.suppliers, validation: PATHS.validation, models: PATHS.models, dev: PATHS.dev },
  pf: { dashboard: PATHS.pfDashboard, requests: PATHS.pfRequests, newRequest: PATHS.pfNewRequest, base: PATHS.pfPeople, validation: PATHS.pfValidation, models: PATHS.pfModels, dev: PATHS.pfDev },
}

export interface NavItem {
  to: string
  label: string
  anyOf: Permission[]
  end?: boolean
}

const P = PERMISSIONS

export const NAV_BY_MODULE: Record<Module, NavItem[]> = {
  pj: [
    { to: PATHS.pjDashboard, label: 'Painel', anyOf: [P.supplierRead] },
    { to: PATHS.requests, label: 'Solicitações', anyOf: [P.requestReadOwn, P.requestReadAll] },
    { to: PATHS.evaluate, label: 'Avaliar', anyOf: [P.evaluationCreate] },
    { to: PATHS.suppliers, label: 'Fornecedores', anyOf: [P.supplierRead] },
    { to: PATHS.validation, label: 'Validação ERP', anyOf: [P.requestApprove] },
    { to: PATHS.models, label: 'Modelos', anyOf: [P.modelRead] },
    { to: PATHS.dev, label: 'Painel dev', anyOf: [P.devPanel, P.usersManage, P.settingsManage] },
  ],
  pf: [
    { to: PATHS.pfDashboard, label: 'Painel', anyOf: [P.supplierRead], end: true },
    { to: PATHS.pfRequests, label: 'Solicitações', anyOf: [P.requestReadOwn, P.requestReadAll] },
    { to: PATHS.pfPeople, label: 'Pessoas', anyOf: [P.supplierRead] },
    { to: PATHS.pfValidation, label: 'Validação ERP', anyOf: [P.requestApprove] },
    { to: PATHS.pfModels, label: 'Modelos', anyOf: [P.modelRead] },
    { to: PATHS.pfDev, label: 'Painel dev', anyOf: [P.devPanel, P.usersManage, P.settingsManage] },
  ],
}

/** Todas as entradas (para achar a primeira tela que o cargo libera). */
export const NAV: NavItem[] = [...NAV_BY_MODULE.pj, ...NAV_BY_MODULE.pf]

const PJ_LIST_PAGES: string[] = [PATHS.pjDashboard, PATHS.requests, PATHS.newRequest, PATHS.evaluate, PATHS.suppliers, PATHS.validation, PATHS.models, PATHS.dev]

/**
 * Módulo pelo endereço: /pf/... é Pessoas Físicas; as listas antigas são Fornecedores.
 * null = tela de detalhe (o módulo vem do registro aberto) ou tela comum (início, Painel dev).
 */
export function moduleOfPath(pathname: string): Module | null {
  if (pathname === '/pf' || pathname.startsWith('/pf/')) return 'pf'
  return PJ_LIST_PAGES.includes(pathname.replace(/\/+$/, '')) ? 'pj' : null
}
