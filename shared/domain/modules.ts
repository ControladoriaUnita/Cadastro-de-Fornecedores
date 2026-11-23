/**
 * Módulos do app. Cada um tem gestão própria (cargos marcam a quais módulos dão acesso no Painel dev).
 *   pj → Fornecedores/PJ (CNPJ): fluxo completo, com consulta à Receita, risco, qualificação e avaliação
 *   pf → Pessoas Físicas/PF (CPF): mesmo fluxo de cadastro, sem homologação, consulta e avaliação
 * O módulo de uma solicitação/cadastro vem do próprio documento (CNPJ = pj, CPF = pf).
 */
import { ALL_PERMISSIONS, DEV_ROLE_KEY, isPermission, type Permission, type RoleKey } from './roles'

export const MODULES = ['pj', 'pf'] as const
export type Module = (typeof MODULES)[number]

export const MODULE_INFO: Record<Module, { label: string; short: string; personKind: 'PJ' | 'PF'; documentLabel: 'CNPJ' | 'CPF'; description: string }> = {
  pj: {
    label: 'Fornecedores/PJ',
    short: 'Fornecedores',
    personKind: 'PJ',
    documentLabel: 'CNPJ',
    description: 'Cadastro e homologação de fornecedores (CNPJ): risco, qualificação, avaliação e gravação no UAU.',
  },
  pf: {
    label: 'Pessoas Físicas/PF',
    short: 'Pessoas Físicas',
    personKind: 'PF',
    documentLabel: 'CPF',
    description: 'Cadastro de pessoas físicas (CPF): dados, documentos e gravação no UAU.',
  },
}

export const isModule = (v: unknown): v is Module => (MODULES as readonly unknown[]).includes(v)
export const moduleOfKind = (kind: string): Module => (kind === 'PF' ? 'pf' : 'pj')

/** Cargo "Dev geral": acesso total aos dois módulos (cargo de sistema, sem módulo). */
export const GLOBAL_DEV_ROLE_KEY = DEV_ROLE_KEY
/** Cargo "Dev" de cada módulo: acesso total só ao próprio módulo (inclusive o Painel dev dele). */
export const moduleDevRoleKey = (m: Module) => `dev-${m}`
export const isDevRoleKey = (key: string) => key === GLOBAL_DEV_ROLE_KEY || MODULES.some((m) => key === moduleDevRoleKey(m))

export interface RoleCatalogItem {
  key: string
  /** null = Dev geral */
  module: string | null
  permissions: readonly string[]
}

/**
 * Permissões do usuário EM CADA MÓDULO (os módulos são independentes: cargo do PF não vale no PJ).
 * Dev geral tem tudo nos dois; o Dev do módulo tem tudo naquele módulo.
 */
export function accessByModule(userRoles: readonly RoleKey[], catalog: readonly RoleCatalogItem[]): Record<Module, Permission[]> {
  const out = { pj: [] as Permission[], pf: [] as Permission[] }
  const globalDev = userRoles.includes(GLOBAL_DEV_ROLE_KEY)
  for (const m of MODULES) {
    if (globalDev || userRoles.includes(moduleDevRoleKey(m))) {
      out[m] = [...ALL_PERMISSIONS]
      continue
    }
    const set = new Set<Permission>()
    for (const r of catalog) if (r.module === m && userRoles.includes(r.key)) for (const p of r.permissions) if (isPermission(p)) set.add(p)
    out[m] = ALL_PERMISSIONS.filter((p) => set.has(p))
  }
  return out
}

/** Módulos em que o usuário tem algum cargo (Dev geral: os dois). */
export function memberModules(userRoles: readonly RoleKey[], catalog: readonly RoleCatalogItem[]): Module[] {
  if (userRoles.includes(GLOBAL_DEV_ROLE_KEY)) return [...MODULES]
  return MODULES.filter((m) => userRoles.includes(moduleDevRoleKey(m)) || catalog.some((r) => r.module === m && userRoles.includes(r.key)))
}
