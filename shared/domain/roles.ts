/**
 * Permissões e cargos.
 *
 * As PERMISSÕES são fixas no código (cada uma libera telas e ações na API).
 * Os CARGOS ficam no banco e são criados/editados no Painel dev: cada cargo é um conjunto de permissões.
 * Um usuário pode ter vários cargos; as permissões se somam.
 *
 * O cargo "dev" é de sistema: sempre tem todas as permissões e não pode ser apagado,
 * para ninguém perder o acesso às configurações.
 */

export const PERMISSIONS = {
  /** Abrir solicitação de cadastro */
  requestCreate: 'request.create',
  /** Ver as próprias solicitações */
  requestReadOwn: 'request.read.own',
  /** Ver todas as solicitações e o kanban completo */
  requestReadAll: 'request.read.all',
  /** Convidar fornecedor, conferir documentos, pedir pendências, enviar para aprovação */
  requestAnalyze: 'request.analyze',
  /** Aprovar e gravar no UAU */
  requestApprove: 'request.approve',
  /** Ver fornecedores e o painel */
  supplierRead: 'supplier.read',
  /** Editar fornecedor, rodar análise de risco, importar do UAU */
  supplierManage: 'supplier.manage',
  /** Avaliar fornecimento */
  evaluationCreate: 'evaluation.create',
  /** Ver modelos de fornecedor */
  modelRead: 'model.read',
  /** Configurações: modelos, tipos de documento, critérios, regras de risco */
  settingsManage: 'settings.manage',
  /** Usuários, cargos e permissões */
  usersManage: 'users.manage',
  /** Painel dev: diagnóstico, e-mails enviados */
  devPanel: 'dev.panel',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]
export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS)
export const isPermission = (v: unknown): v is Permission => (ALL_PERMISSIONS as unknown[]).includes(v)

/** Texto mostrado na tela de cargos, agrupado por área. */
export const PERMISSION_INFO: Record<Permission, { group: string; label: string; description: string }> = {
  'request.create': { group: 'Solicitações', label: 'Abrir solicitação', description: 'Pedir o cadastro de um fornecedor (busca de CNPJ em tempo real).' },
  'request.read.own': { group: 'Solicitações', label: 'Ver as próprias solicitações', description: 'Acompanhar os pedidos que abriu.' },
  'request.read.all': { group: 'Solicitações', label: 'Ver todas as solicitações', description: 'Kanban completo e pedidos de todos.' },
  'request.analyze': { group: 'Solicitações', label: 'Analisar cadastros', description: 'Convidar fornecedor, conferir documentos, rodar risco, pedir pendências, enviar para aprovação, recusar.' },
  'request.approve': { group: 'Solicitações', label: 'Aprovar e gravar no UAU', description: 'Tela de validação ERP e gravação no UAU.' },
  'supplier.read': { group: 'Fornecedores', label: 'Ver fornecedores e painel', description: 'Base de fornecedores, fichas, documentos e indicadores.' },
  'supplier.manage': { group: 'Fornecedores', label: 'Gerir fornecedores', description: 'Mudar situação e modelo, rodar análise de risco, importar do UAU.' },
  'evaluation.create': { group: 'Fornecedores', label: 'Avaliar fornecedores', description: 'Dar notas ao fim de um fornecimento.' },
  'model.read': { group: 'Configurações', label: 'Ver modelos', description: 'Consultar os modelos de fornecedor e documentos exigidos.' },
  'settings.manage': { group: 'Configurações', label: 'Editar configurações', description: 'Modelos, tipos de documento, critérios de avaliação e regras de risco.' },
  'users.manage': { group: 'Administração', label: 'Gerir usuários e cargos', description: 'Criar usuários, cargos e definir permissões.' },
  'dev.panel': { group: 'Administração', label: 'Painel dev', description: 'Diagnóstico das integrações e e-mails enviados.' },
}

/** Chave do cargo de sistema com todas as permissões. */
export const DEV_ROLE_KEY = 'dev'

export type RoleKey = string

export interface RoleDefinition {
  key: RoleKey
  name: string
  description: string
  permissions: Permission[]
}

const P = PERMISSIONS

/** Cargos criados na instalação (depois são editáveis no Painel dev, menos o dev). */
export const DEFAULT_ROLES: RoleDefinition[] = [
  {
    key: 'solicitante',
    name: 'Solicitante',
    description: 'Pede cadastros, acompanha os próprios e avalia fornecedores.',
    permissions: [P.requestCreate, P.requestReadOwn, P.supplierRead, P.evaluationCreate, P.modelRead],
  },
  {
    key: 'analista',
    name: 'Analista de suprimentos',
    description: 'Convida fornecedores, confere documentos e risco, envia para aprovação.',
    permissions: [P.requestCreate, P.requestReadOwn, P.requestReadAll, P.requestAnalyze, P.supplierRead, P.supplierManage, P.evaluationCreate, P.modelRead],
  },
  {
    key: 'aprovador',
    name: 'Aprovação',
    description: 'Tudo do analista, mais validar e gravar no UAU.',
    permissions: [P.requestCreate, P.requestReadOwn, P.requestReadAll, P.requestAnalyze, P.requestApprove, P.supplierRead, P.supplierManage, P.evaluationCreate, P.modelRead],
  },
  { key: DEV_ROLE_KEY, name: 'Dev', description: 'Acesso total, inclusive configurações, usuários e cargos.', permissions: ALL_PERMISSIONS },
]

/** Soma as permissões dos cargos do usuário. O cargo dev sempre vale tudo. */
export function permissionsFor(userRoles: readonly RoleKey[], catalog: readonly Pick<RoleDefinition, 'key' | 'permissions'>[]): Permission[] {
  if (userRoles.includes(DEV_ROLE_KEY)) return [...ALL_PERMISSIONS]
  const set = new Set<Permission>()
  for (const r of catalog) if (userRoles.includes(r.key)) for (const p of r.permissions) if (isPermission(p)) set.add(p)
  return ALL_PERMISSIONS.filter((p) => set.has(p))
}

/** Chave estável a partir do nome do cargo ("Gerente de Obras" → "gerente-de-obras"). */
export function roleKeyFromName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}
