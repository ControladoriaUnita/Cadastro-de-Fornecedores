/**
 * Avisos por e-mail para a equipe. Falha no aviso nunca desfaz a ação principal:
 * o erro fica registrado em email_outbox (Painel dev).
 */
import { and, arrayOverlaps, eq } from 'drizzle-orm'
import { isDevRoleKey, type Module } from '../../shared/domain/modules'
import type { Permission } from '../../shared/domain/roles'
import { schema } from '../infrastructure/db/client'
import type { Db } from '../infrastructure/db/client'
import { notifyEmail } from '../infrastructure/email/templates'
import { envValue } from '../infrastructure/env'
import type { Mailer } from './ports'

export const appUrl = () => (envValue('APP_URL') ?? 'http://localhost:5175').replace(/\/+$/, '')

/**
 * Avisa quem tem a permissão por algum cargo próprio do fluxo.
 * O cargo dev (acesso total) não entra, para não receber todo aviso operacional.
 */
export async function notifyPermission(
  db: Db,
  mailer: Mailer,
  permission: Permission,
  msg: Notice,
  /** Só cargos com acesso a este módulo (gestões separadas: PJ e PF) */
  module: Module,
) {
  const roleRows = await db.select({ key: schema.roles.key, permissions: schema.roles.permissions, module: schema.roles.module }).from(schema.roles)
  // Só cargos do próprio módulo; os cargos Dev (geral e de módulo) não recebem aviso operacional
  const keys = roleRows.filter((r) => !isDevRoleKey(r.key) && r.module === module && r.permissions.includes(permission)).map((r) => r.key)
  if (!keys.length) return
  const rows = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(and(eq(schema.users.active, true), arrayOverlaps(schema.users.roles, keys)))
  await notifyAddresses(mailer, rows.map((r) => r.email), { ...msg, module })
}

/** Aviso por e-mail; `module` define o vocabulário (PF não fala de fornecedor). */
export interface Notice {
  title: string
  lines: string[]
  path: string | null
  requestId: string | null
  module?: Module
}

export async function notifyAddresses(mailer: Mailer, to: string[], msg: Notice) {
  const unique = [...new Set(to.filter(Boolean))]
  if (!unique.length || mailer.provider === 'none') return
  const email = notifyEmail({ title: msg.title, lines: msg.lines, link: msg.path ? `${appUrl()}${msg.path}` : null, module: msg.module })
  try {
    await mailer.send({ ...email, to: unique, requestId: msg.requestId })
  } catch (err) {
    console.warn('[aviso] falhou', err)
  }
}

/** Avisa quem abriu a solicitação (Obra), a não ser que tenha sido ele mesmo a agir. */
export async function notifyRequester(
  db: Db,
  mailer: Mailer,
  requesterId: string,
  msg: Notice,
  actorId: string | null = null,
) {
  if (actorId && actorId === requesterId) return
  const [u] = await db.select({ email: schema.users.email, active: schema.users.active }).from(schema.users).where(eq(schema.users.id, requesterId))
  if (u?.active) await notifyAddresses(mailer, [u.email], msg)
}
