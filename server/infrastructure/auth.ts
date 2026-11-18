/**
 * Login da equipe.
 *   AUTH_MODE=dev   → seletor de usuário (só fora de produção), para testar cada papel
 *   AUTH_MODE=entra → Microsoft Entra ID (OpenID Connect, fluxo authorization code)
 * Em ambos o resultado é o mesmo cookie de sessão assinado (STAFF_COOKIE, 12 h).
 * Só entra quem foi cadastrado no Painel dev (por e-mail) e está ativo.
 */
import { eq } from 'drizzle-orm'
import { permissionsFor, type Permission, type RoleKey } from '../../shared/domain/roles'
import { AppError, type Actor } from '../application/context'
import type { Db } from './db/client'
import { schema } from './db/client'
import { envOption, envValue, isProduction } from './env'
import { randomToken, signSession, verifySession } from './security'

export const STAFF_SESSION_HOURS = 12

export const authMode = (): 'dev' | 'entra' => (envOption('AUTH_MODE') === 'entra' ? 'entra' : 'dev')

export function entraConfigured() {
  return !!(envValue('ENTRA_TENANT_ID') && envValue('ENTRA_CLIENT_ID') && envValue('ENTRA_CLIENT_SECRET'))
}

export function devLoginAllowed() {
  return authMode() === 'dev' && !isProduction()
}

/** Cargos cadastrados (chave → nome e permissões). */
export async function loadRoleCatalog(db: Db) {
  return db.select({ key: schema.roles.key, name: schema.roles.name, permissions: schema.roles.permissions }).from(schema.roles)
}

export async function loadActor(db: Db, userId: string): Promise<Actor | null> {
  const [[u], catalog] = await Promise.all([db.select().from(schema.users).where(eq(schema.users.id, userId)), loadRoleCatalog(db)])
  if (!u || !u.active) return null
  const roles = u.roles as RoleKey[]
  const names = new Map(catalog.map((r) => [r.key, r.name]))
  return {
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    roles,
    roleNames: roles.map((r) => names.get(r) ?? r),
    permissions: permissionsFor(roles, catalog as { key: string; permissions: Permission[] }[]),
  }
}

export function issueStaffSession(userId: string) {
  const maxAge = STAFF_SESSION_HOURS * 3600
  return { value: signSession({ kind: 'user', sub: userId, exp: Math.floor(Date.now() / 1000) + maxAge }), maxAge }
}

// ----------------------------------------------------------------------------- Microsoft Entra ID

const redirectUri = () => `${(envValue('APP_URL') ?? 'http://localhost:5175').replace(/\/+$/, '')}/api/auth/microsoft/callback`

/** Monta a URL de login da Microsoft. O `state` assinado protege contra CSRF no retorno. */
export function entraAuthorizeUrl(): { url: string; state: string } {
  if (!entraConfigured()) throw new AppError('ENTRA_NOT_CONFIGURED', 'Login Microsoft ainda não configurado (ENTRA_*).', 503)
  const nonce = randomToken(16)
  const state = signSession({ kind: 'user', sub: `state:${nonce}`, exp: Math.floor(Date.now() / 1000) + 600 })
  const q = new URLSearchParams({
    client_id: envValue('ENTRA_CLIENT_ID')!,
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: 'openid profile email',
    state,
    nonce,
    // Sempre mostra a escolha de conta (computador compartilhado ou mais de uma conta Microsoft)
    prompt: 'select_account',
  })
  return { url: `https://login.microsoftonline.com/${encodeURIComponent(envValue('ENTRA_TENANT_ID')!)}/oauth2/v2.0/authorize?${q}`, state }
}

/** Troca o código por tokens e identifica o usuário cadastrado. */
export async function entraCallback(db: Db, code: string, state: string, cookieState: string | null): Promise<string> {
  const st = verifySession(state, 'user')
  if (!st || !st.sub.startsWith('state:') || state !== cookieState) throw new AppError('ENTRA_STATE', 'Login expirado. Tente entrar de novo.', 400)
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(envValue('ENTRA_TENANT_ID')!)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: envValue('ENTRA_CLIENT_ID')!,
      client_secret: envValue('ENTRA_CLIENT_SECRET')!,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      scope: 'openid profile email',
    }),
    signal: AbortSignal.timeout(20_000),
  })
  const data = (await res.json().catch(() => ({}))) as { id_token?: string; error_description?: string }
  if (!res.ok || !data.id_token) throw new AppError('ENTRA_TOKEN', `A Microsoft recusou o login. ${data.error_description?.split('\r\n')[0] ?? ''}`.trim(), 401)
  // id_token recebido direto do endpoint de token (TLS + client secret): leitura das claims sem nova verificação de assinatura
  const claims = JSON.parse(Buffer.from(data.id_token.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
    oid?: string
    tid?: string
    email?: string
    preferred_username?: string
    nonce?: string
  }
  if (claims.tid && claims.tid !== envValue('ENTRA_TENANT_ID')) throw new AppError('ENTRA_TENANT', 'Conta de outra organização.', 403)
  if (claims.nonce !== st.sub.slice('state:'.length)) throw new AppError('ENTRA_NONCE', 'Login inválido. Tente de novo.', 400)
  const email = (claims.email ?? claims.preferred_username ?? '').toLowerCase()
  const [byOid] = claims.oid ? await db.select().from(schema.users).where(eq(schema.users.entraOid, claims.oid)) : []
  const [byEmail] = byOid ? [byOid] : email ? await db.select().from(schema.users).where(eq(schema.users.email, email)) : []
  const user = byOid ?? byEmail
  if (!user || !user.active) throw new AppError('NO_ACCESS', 'Seu usuário ainda não tem acesso. Peça a liberação a quem administra o app.', 403)
  await db.update(schema.users).set({ entraOid: claims.oid ?? user.entraOid, lastLoginAt: new Date() }).where(eq(schema.users.id, user.id))
  return user.id
}
