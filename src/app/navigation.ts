/**
 * Menu principal e rotas. Para criar uma tela nova: rota em App.tsx + item aqui.
 */
import { PERMISSIONS, type Permission } from '@shared/domain/roles'

export const PATHS = {
  home: '/',
  requests: '/solicitacoes',
  newRequest: '/solicitacoes/nova',
  request: (id: string) => `/solicitacoes/${id}`,
  suppliers: '/fornecedores',
  supplier: (id: string) => `/fornecedores/${id}`,
  validation: '/validacao',
  validate: (id: string) => `/validacao/${id}`,
  models: '/modelos',
  dev: '/dev',
} as const

export interface NavItem {
  to: string
  label: string
  anyOf: Permission[]
  end?: boolean
}

export const NAV: NavItem[] = [
  { to: PATHS.home, label: 'Painel', anyOf: [PERMISSIONS.supplierRead], end: true },
  { to: PATHS.requests, label: 'Solicitações', anyOf: [PERMISSIONS.requestReadOwn, PERMISSIONS.requestReadAll] },
  { to: PATHS.suppliers, label: 'Fornecedores', anyOf: [PERMISSIONS.supplierRead] },
  { to: PATHS.validation, label: 'Validação ERP', anyOf: [PERMISSIONS.requestApprove] },
  { to: PATHS.models, label: 'Modelos', anyOf: [PERMISSIONS.modelRead] },
  { to: PATHS.dev, label: 'Painel dev', anyOf: [PERMISSIONS.devPanel, PERMISSIONS.usersManage, PERMISSIONS.settingsManage] },
]
