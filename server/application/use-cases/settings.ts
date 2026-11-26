/**
 * Configurações mantidas pelo perfil dev: tipos de documento, modelos de fornecedor,
 * critérios de avaliação, regras de risco e usuários da equipe.
 */
import { and, asc, eq } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  criterionSchema,
  CriterionDTO,
  documentTypeSchema,
  DocumentTypeDTO,
  ModelDTO,
  modelSchema,
  RiskRuleDTO,
  riskRuleUpdateSchema,
  RoleDTO,
  roleSchema,
  TeamUserDTO,
  teamUserSchema,
} from '../../../shared/contracts'
import { RISK_RULE_KEYS, RISK_RULES, defaultRuleConfigs, type RiskRuleConfig, type RiskRuleKey, type RiskSeverity } from '../../../shared/domain/risk'
import { ALL_PERMISSIONS, isPermission, PERMISSIONS, roleKeyFromName, type RoleKey } from '../../../shared/domain/roles'
import { GLOBAL_DEV_ROLE_KEY, isDevRoleKey, MODULE_INFO, moduleDevRoleKey, moduleOfKind, type Module } from '../../../shared/domain/modules'
import type { Db } from '../../infrastructure/db/client'
import { schema } from '../../infrastructure/db/client'
import { AppError, notFound, requirePermission, requireModule } from '../context'
import { toModel } from '../mappers'
import type { UseCaseDeps } from '../ports'

const { documentTypes, evaluationCriteria, modelRequirements, requests, riskRuleConfigs, roles, supplierModels, suppliers, users } = schema
const manage = (deps: UseCaseDeps) => requirePermission(deps.ctx.actor, PERMISSIONS.settingsManage)

// ----------------------------------------------------------------------------- tipos de documento

export async function listDocumentTypes(deps: UseCaseDeps): Promise<DocumentTypeDTO[]> {
  requirePermission(deps.ctx.actor, PERMISSIONS.modelRead, PERMISSIONS.settingsManage)
  // Cada módulo tem a sua lista de tipos de documento
  return deps.db.select().from(documentTypes).where(eq(documentTypes.module, currentModule(deps))).orderBy(asc(documentTypes.sort), asc(documentTypes.name))
}

export async function saveDocumentType(deps: UseCaseDeps, id: string | null, input: z.infer<typeof documentTypeSchema>) {
  manage(deps)
  const values = {
    ...input,
    description: input.description ?? null,
    defaultValidityDays: input.hasExpiry ? (input.defaultValidityDays ?? null) : null,
  }
  const module = currentModule(deps)
  if (!id) return (await deps.db.insert(documentTypes).values({ ...values, module }).returning())[0]
  const [row] = await deps.db.update(documentTypes).set(values).where(and(eq(documentTypes.id, id), eq(documentTypes.module, module))).returning()
  if (!row) throw notFound('Tipo de documento')
  return row
}

// ----------------------------------------------------------------------------- modelos

export async function listModels(deps: UseCaseDeps, opts: { onlyActive?: boolean; module?: Module } = {}): Promise<ModelDTO[]> {
  requirePermission(deps.ctx.actor, PERMISSIONS.modelRead, PERMISSIONS.requestCreate)
  const all = await loadAllModels(deps.db, opts)
  if (!opts.module) return all.filter((m) => m.personKind === 'ambos' || deps.ctx.actor.modules.includes(moduleOfKind(m.personKind)))
  requireModule(deps.ctx.actor, opts.module)
  // Modelos de cada módulo: PJ (CNPJ) ou PF (CPF); "ambos" aparece nos dois
  return all.filter((m) => m.personKind === 'ambos' || m.personKind === MODULE_INFO[opts.module!].personKind)
}

export async function loadAllModels(db: Db, opts: { onlyActive?: boolean } = {}): Promise<ModelDTO[]> {
  const models = await db.select().from(supplierModels).orderBy(asc(supplierModels.name))
  const reqs = await db
    .select({ req: modelRequirements, type: documentTypes })
    .from(modelRequirements)
    .innerJoin(documentTypes, eq(documentTypes.id, modelRequirements.documentTypeId))
  return models
    .filter((m) => !opts.onlyActive || m.active)
    .map((m) =>
      toModel(
        m,
        reqs.filter((r) => r.req.modelId === m.id),
      ),
    )
}

export async function saveModel(deps: UseCaseDeps, id: string | null, input: z.infer<typeof modelSchema>): Promise<ModelDTO> {
  manage(deps)
  const ids = input.requirements.map((r) => r.documentTypeId)
  if (new Set(ids).size !== ids.length) throw new AppError('DUPLICATE_REQUIREMENT', 'O mesmo documento aparece duas vezes no modelo.', 422)
  // Módulos independentes: o modelo é do tipo de pessoa do módulo e usa só os tipos de documento dele
  const module = currentModule(deps)
  if (input.personKind !== MODULE_INFO[module].personKind) throw new AppError('WRONG_MODULE', `Modelos deste módulo são de ${MODULE_INFO[module].documentLabel}.`, 422)
  if (ids.length) {
    const own = await deps.db.select({ id: documentTypes.id }).from(documentTypes).where(eq(documentTypes.module, module))
    if (ids.some((x) => !own.some((o) => o.id === x))) throw new AppError('WRONG_MODULE', 'Use só tipos de documento deste módulo.', 422)
  }
  const values = {
    name: input.name,
    description: input.description ?? null,
    personKind: input.personKind,
    expectedCnaePrefixes: input.expectedCnaePrefixes,
    active: input.active,
    updatedAt: deps.ctx.now(),
  }
  let modelId = id
  if (!modelId) {
    modelId = (await deps.db.insert(supplierModels).values(values).returning({ id: supplierModels.id }))[0]!.id
  } else {
    const [row] = await deps.db.update(supplierModels).set(values).where(eq(supplierModels.id, modelId)).returning({ id: supplierModels.id })
    if (!row) throw notFound('Modelo de fornecedor')
    await deps.db.delete(modelRequirements).where(eq(modelRequirements.modelId, modelId))
  }
  if (input.requirements.length) {
    await deps.db.insert(modelRequirements).values(
      input.requirements.map((r, i) => ({
        modelId: modelId!,
        documentTypeId: r.documentTypeId,
        required: r.required,
        instructions: r.instructions ?? null,
        sort: i,
      })),
    )
  }
  return (await loadAllModels(deps.db)).find((m) => m.id === modelId)!
}

/** Exclui um modelo que nunca foi usado; modelo já usado por fornecedor ou solicitação só pode ser desativado. */
export async function deleteModel(deps: UseCaseDeps, id: string): Promise<{ ok: true }> {
  manage(deps)
  const [model] = await deps.db.select().from(supplierModels).where(eq(supplierModels.id, id))
  const module = currentModule(deps)
  if (!model || (model.personKind !== 'ambos' && model.personKind !== MODULE_INFO[module].personKind)) throw notFound('Modelo de fornecedor')
  const usedBySuppliers = (await deps.db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.modelId, id))).length
  const usedByRequests = (await deps.db.select({ id: requests.id }).from(requests).where(eq(requests.modelId, id))).length
  if (usedBySuppliers || usedByRequests) {
    const parts = [usedBySuppliers && `${usedBySuppliers} cadastro(s)`, usedByRequests && `${usedByRequests} solicitação(ões)`].filter(Boolean).join(' e ')
    throw new AppError('MODEL_IN_USE', `Este modelo está em uso por ${parts}. Desative-o em vez de excluir.`, 409)
  }
  await deps.db.delete(supplierModels).where(eq(supplierModels.id, id))
  return { ok: true }
}

// ----------------------------------------------------------------------------- critérios de avaliação

export async function listCriteria(deps: UseCaseDeps): Promise<CriterionDTO[]> {
  return deps.db.select().from(evaluationCriteria).orderBy(asc(evaluationCriteria.sort), asc(evaluationCriteria.name))
}

export async function saveCriterion(deps: UseCaseDeps, id: string | null, input: z.infer<typeof criterionSchema>) {
  manage(deps)
  const values = { ...input, description: input.description ?? null }
  if (!id) return (await deps.db.insert(evaluationCriteria).values(values).returning())[0]
  const [row] = await deps.db.update(evaluationCriteria).set(values).where(eq(evaluationCriteria.id, id)).returning()
  if (!row) throw notFound('Critério')
  return row
}

// ----------------------------------------------------------------------------- regras de risco

export async function loadRiskConfigs(db: Db): Promise<RiskRuleConfig[]> {
  const rows = await db.select().from(riskRuleConfigs)
  const byKey = new Map(rows.map((r) => [r.key, r]))
  return defaultRuleConfigs().map((d) => {
    const r = byKey.get(d.key)
    return r ? { key: d.key, severity: r.severity as RiskSeverity, param: r.param } : d
  })
}

export async function listRiskRules(deps: UseCaseDeps): Promise<RiskRuleDTO[]> {
  requirePermission(deps.ctx.actor, PERMISSIONS.supplierManage, PERMISSIONS.settingsManage)
  return (await loadRiskConfigs(deps.db)).map((c) => ({ key: c.key, definition: RISK_RULES[c.key], severity: c.severity, param: c.param }))
}

export async function updateRiskRules(deps: UseCaseDeps, input: z.infer<typeof riskRuleUpdateSchema>) {
  manage(deps)
  for (const r of input.rules) {
    if (!RISK_RULE_KEYS.includes(r.key as RiskRuleKey)) continue
    const values = { key: r.key, severity: r.severity, param: RISK_RULES[r.key].param ? r.param : null, updatedAt: deps.ctx.now(), updatedBy: deps.ctx.actor.id }
    await deps.db.insert(riskRuleConfigs).values(values).onConflictDoUpdate({ target: riskRuleConfigs.key, set: values })
  }
  return listRiskRules(deps)
}

// ----------------------------------------------------------------------------- usuários (por módulo)

/**
 * Módulos independentes: cada Painel dev gerencia só os cargos do próprio módulo.
 * A pessoa (e-mail, login Microsoft) é uma só; os cargos dela em outro módulo não são tocados.
 * O "Dev geral" (cargo dev, sem módulo) aparece nos dois painéis, só para consulta.
 */
const manageUsers = (deps: UseCaseDeps) => requirePermission(deps.ctx.actor, PERMISSIONS.usersManage)
const currentModule = (deps: UseCaseDeps): Module => deps.ctx.module ?? 'pj'

async function moduleRoleKeys(db: Db, module: Module): Promise<Set<string>> {
  return new Set((await db.select({ key: roles.key }).from(roles).where(eq(roles.module, module))).map((r) => r.key))
}

export async function listUsers(deps: UseCaseDeps): Promise<TeamUserDTO[]> {
  manageUsers(deps)
  const module = currentModule(deps)
  const keys = await moduleRoleKeys(deps.db, module)
  const rows = await deps.db.select().from(users).orderBy(asc(users.fullName))
  return rows
    .filter((u) => u.roles.includes(GLOBAL_DEV_ROLE_KEY) || u.roles.some((r) => keys.has(r)))
    .map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      // só os cargos deste módulo (+ Dev geral, para mostrar)
      roles: u.roles.filter((r) => keys.has(r) || r === GLOBAL_DEV_ROLE_KEY) as RoleKey[],
      active: u.active,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    }))
}

/** Quantos usuários ativos têm o Dev geral (para nunca zerar). */
async function activeGlobalDevs(db: Db, exceptUserId: string | null) {
  const rows = await db.select({ id: users.id, roles: users.roles, active: users.active }).from(users)
  return rows.filter((u) => u.active && u.roles.includes(GLOBAL_DEV_ROLE_KEY) && u.id !== exceptUserId).length
}

/**
 * Cria ou atualiza a pessoa NESTE módulo. `input.roles` são os cargos dela aqui (vazio = tirar do módulo).
 * Se o e-mail já existe (pessoa de outro módulo), só acrescenta os cargos deste módulo.
 */
export async function saveUser(deps: UseCaseDeps, id: string | null, input: z.infer<typeof teamUserSchema>) {
  manageUsers(deps)
  const module = currentModule(deps)
  const actor = deps.ctx.actor
  const keys = await moduleRoleKeys(deps.db, module)
  const wanted = [...new Set(input.roles.filter((r) => r !== GLOBAL_DEV_ROLE_KEY))]
  const foreign = wanted.filter((r) => !keys.has(r))
  if (foreign.length) throw new AppError('UNKNOWN_ROLE', `Cargo que não é deste módulo: ${foreign.join(', ')}.`, 422)

  const [byId] = id ? await deps.db.select().from(users).where(eq(users.id, id)) : []
  if (id && !byId) throw notFound('Usuário')
  const [byEmail] = !id ? await deps.db.select().from(users).where(eq(users.email, input.email)) : []
  const current = byId ?? byEmail ?? null

  // O Dev do módulo só é dado ou tirado por um Dev (geral ou do próprio módulo)
  const devKey = moduleDevRoleKey(module)
  const actorIsDev = actor.globalDev || actor.roles.includes(devKey)
  const touchesDev = wanted.includes(devKey) !== !!current?.roles.includes(devKey)
  if (touchesDev && !actorIsDev) throw new AppError('FORBIDDEN', 'Só um Dev pode dar ou tirar o cargo Dev do módulo.', 403)
  if (current?.id === actor.id && current.roles.includes(devKey) && !wanted.includes(devKey)) {
    throw new AppError('SELF_LOCKOUT', 'Você não pode tirar o próprio cargo Dev do módulo.', 422)
  }

  // Ativo/inativo vale para a pessoa inteira (os dois módulos): só o Dev geral muda
  const active = actor.globalDev ? input.active : (current?.active ?? true)
  if (current?.id === actor.id && !active) throw new AppError('SELF_LOCKOUT', 'Você não pode se desativar.', 422)
  if (current?.roles.includes(GLOBAL_DEV_ROLE_KEY) && !active && (await activeGlobalDevs(deps.db, current.id)) === 0) {
    throw new AppError('LAST_DEV', 'Precisa existir ao menos um Dev geral ativo.', 422)
  }

  // Mantém os cargos de outros módulos (e o Dev geral) e troca só os deste módulo
  const kept = (current?.roles ?? []).filter((r) => !keys.has(r))
  const roleList = [...kept, ...wanted]
  if (!current && !wanted.length) throw new AppError('ROLE_REQUIRED', 'Escolha ao menos um cargo.', 422)
  try {
    if (!current) return (await deps.db.insert(users).values({ fullName: input.fullName, email: input.email, roles: roleList, active }).returning())[0]
    return (
      await deps.db
        .update(users)
        .set({ fullName: input.fullName, email: input.email, roles: roleList, active })
        .where(eq(users.id, current.id))
        .returning()
    )[0]
  } catch (err) {
    if (err instanceof Error && /users_email/i.test(err.message)) throw new AppError('DUPLICATE_EMAIL', 'Já existe um usuário com este e-mail.', 409)
    throw err
  }
}

// ----------------------------------------------------------------------------- cargos e permissões (por módulo)

export async function listRoles(deps: UseCaseDeps): Promise<RoleDTO[]> {
  manageUsers(deps)
  const module = currentModule(deps)
  const [rows, userRows] = await Promise.all([
    deps.db.select().from(roles).where(eq(roles.module, module)).orderBy(asc(roles.name)),
    deps.db.select({ roles: users.roles }).from(users),
  ])
  return rows.map((r) => ({
    key: r.key,
    name: r.name,
    description: r.description,
    permissions: r.system ? [...ALL_PERMISSIONS] : r.permissions.filter(isPermission),
    module,
    system: r.system,
    users: userRows.filter((u) => u.roles.includes(r.key)).length,
  }))
}

export async function saveRole(deps: UseCaseDeps, key: string | null, input: z.infer<typeof roleSchema>): Promise<RoleDTO[]> {
  manageUsers(deps)
  const module = currentModule(deps)
  const now = deps.ctx.now()
  const values = { name: input.name, description: input.description ?? null, permissions: [...new Set(input.permissions)], updatedAt: now }
  if (!key) {
    // Chave única no app inteiro: cargos novos do PF levam o prefixo "pf-"
    const slug = roleKeyFromName(input.name)
    if (!slug) throw new AppError('INVALID_NAME', 'Use letras ou números no nome do cargo.', 422)
    const newKey = module === 'pj' ? slug : `${module}-${slug}`.slice(0, 40)
    const [exists] = await deps.db.select({ key: roles.key }).from(roles).where(eq(roles.key, newKey))
    if (exists || isDevRoleKey(newKey)) throw new AppError('DUPLICATE_ROLE', 'Já existe um cargo com este nome.', 409)
    await deps.db.insert(roles).values({ key: newKey, ...values, module })
  } else {
    const [current] = await deps.db.select().from(roles).where(eq(roles.key, key))
    if (!current || current.module !== module) throw notFound('Cargo')
    // Cargo Dev mantém todas as permissões; só nome e descrição mudam
    await deps.db
      .update(roles)
      .set(current.system ? { name: values.name, description: values.description, updatedAt: now } : values)
      .where(eq(roles.key, key))
  }
  return listRoles(deps)
}

export async function deleteRole(deps: UseCaseDeps, key: string): Promise<RoleDTO[]> {
  manageUsers(deps)
  const [current] = await deps.db.select().from(roles).where(eq(roles.key, key))
  if (!current || current.module !== currentModule(deps)) throw notFound('Cargo')
  if (current.system) throw new AppError('SYSTEM_ROLE', 'O cargo Dev é de sistema e não pode ser apagado.', 422)
  const holders = (await deps.db.select({ roles: users.roles }).from(users)).filter((u) => u.roles.includes(key)).length
  if (holders) throw new AppError('ROLE_IN_USE', `${holders} usuário(s) ainda têm este cargo. Troque o cargo deles antes de apagar.`, 409)
  await deps.db.delete(roles).where(eq(roles.key, key))
  return listRoles(deps)
}
