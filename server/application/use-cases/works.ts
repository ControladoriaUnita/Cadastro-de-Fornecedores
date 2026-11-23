/**
 * Obras da Unità: lista suspensa dos campos "Obra" (pré-cadastro e avaliação).
 * Cadastro inicial veio da ferramenta de Planejamento; novas obras entram pelo Painel dev.
 * Solicitações e avaliações guardam o NOME da obra (texto), para o histórico não mudar
 * se a obra for renomeada ou desativada depois.
 */
import { asc, eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { WorkDTO, workSchema } from '../../../shared/contracts'
import { PERMISSIONS } from '../../../shared/domain/roles'
import { schema } from '../../infrastructure/db/client'
import type { Db } from '../../infrastructure/db/client'
import { AppError, notFound, requirePermission } from '../context'
import type { UseCaseDeps } from '../ports'

const { works } = schema

const toDTO = (w: typeof works.$inferSelect): WorkDTO => ({ id: w.id, name: w.name, uauCode: w.uauCode, client: w.client, city: w.city, active: w.active })

/** Todas as obras (o Painel dev vê as inativas; os campos de obra só mostram as ativas). */
export async function listWorks(deps: UseCaseDeps): Promise<WorkDTO[]> {
  requirePermission(deps.ctx.actor, PERMISSIONS.requestCreate, PERMISSIONS.evaluationCreate, PERMISSIONS.requestAnalyze, PERMISSIONS.settingsManage)
  return (await deps.db.select().from(works).orderBy(asc(works.name))).map(toDTO)
}

export async function saveWork(deps: UseCaseDeps, id: string | null, input: z.infer<typeof workSchema>): Promise<WorkDTO> {
  requirePermission(deps.ctx.actor, PERMISSIONS.settingsManage)
  const values = { name: input.name, uauCode: input.uauCode ?? null, client: input.client ?? null, city: input.city ?? null, active: input.active }
  const [same] = await deps.db.select({ id: works.id }).from(works).where(sql`lower(${works.name}) = lower(${input.name})`)
  if (same && same.id !== id) throw new AppError('WORK_EXISTS', `Já existe a obra "${input.name}".`, 409)
  if (!id) return toDTO((await deps.db.insert(works).values(values).returning())[0]!)
  const [row] = await deps.db.update(works).set(values).where(eq(works.id, id)).returning()
  if (!row) throw notFound('Obra')
  return toDTO(row)
}

/** Confere que a obra escolhida existe e está ativa; devolve o nome como está no cadastro. */
export async function resolveWorkName(db: Db, name: string): Promise<string> {
  const [w] = await db.select({ name: works.name, active: works.active }).from(works).where(sql`lower(${works.name}) = lower(${name.trim()})`)
  if (!w || !w.active) throw new AppError('WORK_NOT_FOUND', `Obra "${name}" não está no cadastro de obras ativas. Escolha uma da lista ou peça o cadastro no Painel dev.`, 422)
  return w.name
}
