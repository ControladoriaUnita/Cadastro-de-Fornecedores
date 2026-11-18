/**
 * Painel dev: diagnóstico das integrações e e-mails registrados.
 */
import { desc, sql } from 'drizzle-orm'
import type { DiagnosticsDTO, OutboxItemDTO } from '../../../shared/contracts'
import { PERMISSIONS } from '../../../shared/domain/roles'
import { authMode } from '../../infrastructure/auth'
import { schema } from '../../infrastructure/db/client'
import { emailProvider } from '../../infrastructure/email'
import { envPresence } from '../../infrastructure/env'
import { storageKind } from '../../infrastructure/storage'
import { uauMode } from '../../infrastructure/uau'
import { requirePermission } from '../context'
import type { UseCaseDeps } from '../ports'

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err))

export async function diagnostics(deps: UseCaseDeps): Promise<DiagnosticsDTO> {
  requirePermission(deps.ctx.actor, PERMISSIONS.devPanel)
  const database = await (async () => {
    const t = Date.now()
    try {
      await deps.db.execute(sql`select 1`)
      return { ok: true, ms: Date.now() - t, error: null }
    } catch (err) {
      return { ok: false, ms: null, error: errMsg(err) }
    }
  })()
  const login = await (async () => {
    try {
      const ms = await deps.uau.checkLogin()
      return { ok: true, ms, error: null }
    } catch (err) {
      return { ok: false, ms: null, error: errMsg(err) }
    }
  })()
  return {
    env: envPresence(),
    authMode: authMode(),
    uau: { mode: uauMode(), writeEnabled: deps.uau.writeEnabled, login },
    database,
    email: { provider: emailProvider() },
    storage: { kind: storageKind() },
    transparencia: { configured: deps.sanctions.configured },
  }
}

export async function listOutbox(deps: UseCaseDeps): Promise<OutboxItemDTO[]> {
  requirePermission(deps.ctx.actor, PERMISSIONS.devPanel)
  const rows = await deps.db.select().from(schema.emailOutbox).orderBy(desc(schema.emailOutbox.createdAt)).limit(50)
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
}
