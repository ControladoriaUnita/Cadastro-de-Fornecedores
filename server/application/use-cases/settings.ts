/**
 * Configurações mantidas pelo perfil dev: tipos de documento, modelos de fornecedor,
 * critérios de avaliação, regras de risco e usuários da equipe.
 */
import { asc, eq } from 'drizzle-orm'
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
import { ALL_PERMISSIONS, DEV_ROLE_KEY, isPermission, PERMISSIONS, roleKeyFromName, type RoleKey } from '../../../shared/domain/roles'
import type { Db } from '../../infrastructure/db/client'
import { schema } from '../../infrastructure/db/client'
import { AppError, notFound, requirePermission } from '../context'
import { toModel } from '../mappers'
import type { UseCaseDeps } from '../ports'

const { documentTypes, evaluationCriteria, modelRequirements, riskRuleConfigs, roles, supplierModels, users } = schema
const manage = (deps: UseCaseDeps) => requirePermission(deps.ctx.actor, PERMISSIONS.settingsManage)

// ----------------------------------------------------------------------------- tipos de documento

export async function listDocumentTypes(deps: UseCaseDeps): Promise<DocumentTypeDTO[]> {
  requirePermission(deps.ctx.actor, PERMISSIONS.modelRead, PERMISSIONS.settingsManage)
  return deps.db.select().from(documentTypes).orderBy(asc(documentTypes.sort), asc(documentTypes.name))
}

export async function saveDocumentType(deps: UseCaseDeps, id: string | null, input: z.infer<typeof documentTypeSchema>) {
  manage(deps)
  const values = {
    ...input,
    description: input.description ?? null,
    defaultValidityDays: input.hasExpiry ? (input.defaultValidityDays ?? null) : null,
  }
  if (!id) return (await deps.db.insert(documentTypes).values(values).returning())[0]
  const [row] = await deps.db.update(documentTypes).set(values).where(eq(documentTypes.id, id)).returning()
  if (!row) throw notFound('Tipo de documento')
  return row
}

// ----------------------------------------------------------------------------- modelos

export async function listModels(deps: UseCaseDeps, opts: { onlyActive?: boolean } = {}): Promise<ModelDTO[]> {
  requirePermission(deps.ctx.actor, PERMISSIONS.modelRead, PERMISSIONS.requestCreate)
  return loadAllModels(deps.db, opts)
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

// ----------------------------------------------------------------------------- usuários

const manageUsers = (deps: UseCaseDeps) => requirePermission(deps.ctx.actor, PERMISSIONS.usersManage)

export async function listUsers(deps: UseCaseDeps): Promise<TeamUserDTO[]> {
  manageUsers(deps)
  const rows = await deps.db.select().from(users).orderBy(asc(users.fullName))
  return rows.map((u) => ({
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    roles: u.roles as RoleKey[],
    active: u.active,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  }))
}

/** Quantos usuários ativos têm o cargo dev (para nunca zerar). */
async function activeDevs(db: Db, exceptUserId: string | null) {
  const rows = await db.select({ id: users.id, roles: users.roles, active: users.active }).from(users)
  return rows.filter((u) => u.active && u.roles.includes(DEV_ROLE_KEY) && u.id !== exceptUserId).length
}

export async function saveUser(deps: UseCaseDeps, id: string | null, input: z.infer<typeof teamUserSchema>) {
  manageUsers(deps)
  const roleKeys = new Set((await deps.db.select({ key: roles.key }).from(roles)).map((r) => r.key))
  const unknown = input.roles.filter((r) => !roleKeys.has(r))
  if (unknown.length) throw new AppError('UNKNOWN_ROLE', `Cargo inexistente: ${unknown.join(', ')}.`, 422)
  const values = { ...input, roles: [...new Set(input.roles)] }

  // Só quem é dev pode dar ou tirar o cargo dev
  const [current] = id ? await deps.db.select().from(users).where(eq(users.id, id)) : []
  if (id && !current) throw notFound('Usuário')
  const touchesDev = values.roles.includes(DEV_ROLE_KEY) !== !!current?.roles.includes(DEV_ROLE_KEY)
  if (touchesDev && !deps.ctx.actor.roles.includes(DEV_ROLE_KEY)) {
    throw new AppError('FORBIDDEN', 'Só quem tem o cargo Dev pode dar ou tirar esse cargo.', 403)
  }
  if (id === deps.ctx.actor.id && (!values.active || !values.roles.includes(DEV_ROLE_KEY)) && deps.ctx.actor.roles.includes(DEV_ROLE_KEY)) {
    throw new AppError('SELF_LOCKOUT', 'Você não pode tirar o próprio cargo Dev nem se desativar.', 422)
  }
  if (current?.roles.includes(DEV_ROLE_KEY) && (!values.active || !values.roles.includes(DEV_ROLE_KEY)) && (await activeDevs(deps.db, current.id)) === 0) {
    throw new AppError('LAST_DEV', 'Precisa existir ao menos um usuário ativo com o cargo Dev.', 422)
  }
  try {
    if (!id) return (await deps.db.insert(users).values(values).returning())[0]
    return (await deps.db.update(users).set(values).where(eq(users.id, id)).returning())[0]
  } catch (err) {
    if (err instanceof Error && /users_email/i.test(err.message)) throw new AppError('DUPLICATE_EMAIL', 'Já existe um usuário com este e-mail.', 409)
    throw err
  }
}

// ----------------------------------------------------------------------------- cargos e permissões

export async function listRoles(deps: UseCaseDeps): Promise<RoleDTO[]> {
  manageUsers(deps)
  const [rows, userRows] = await Promise.all([deps.db.select().from(roles).orderBy(asc(roles.name)), deps.db.select({ roles: users.roles }).from(users)])
  return rows.map((r) => ({
    key: r.key,
    name: r.name,
    description: r.description,
    permissions: r.key === DEV_ROLE_KEY ? [...ALL_PERMISSIONS] : r.permissions.filter(isPermission),
    system: r.system,
    users: userRows.filter((u) => u.roles.includes(r.key)).length,
  }))
}

export async function saveRole(deps: UseCaseDeps, key: string | null, input: z.infer<typeof roleSchema>): Promise<RoleDTO[]> {
  manageUsers(deps)
  const now = deps.ctx.now()
  const values = { name: input.name, description: input.description ?? null, permissions: [...new Set(input.permissions)], updatedAt: now }
  if (!key) {
    const newKey = roleKeyFromName(input.name)
    if (!newKey) throw new AppError('INVALID_NAME', 'Use letras ou números no nome do cargo.', 422)
    const [exists] = await deps.db.select({ key: roles.key }).from(roles).where(eq(roles.key, newKey))
    if (exists) throw new AppError('DUPLICATE_ROLE', 'Já existe um cargo com este nome.', 409)
    await deps.db.insert(roles).values({ key: newKey, ...values })
  } else {
    const [current] = await deps.db.select().from(roles).where(eq(roles.key, key))
    if (!current) throw notFound('Cargo')
    // O cargo dev mantém todas as permissões; só nome e descrição mudam
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
  if (!current) throw notFound('Cargo')
  if (current.system) throw new AppError('SYSTEM_ROLE', 'O cargo Dev é de sistema e não pode ser apagado.', 422)
  const holders = (await deps.db.select({ roles: users.roles }).from(users)).filter((u) => u.roles.includes(key)).length
  if (holders) throw new AppError('ROLE_IN_USE', `${holders} usuário(s) ainda têm este cargo. Troque o cargo deles antes de apagar.`, 409)
  await deps.db.delete(roles).where(eq(roles.key, key))
  return listRoles(deps)
}
