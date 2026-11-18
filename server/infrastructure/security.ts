/**
 * Primitivas de segurança: cookie de sessão assinado (HMAC-SHA256), tokens aleatórios e hashes.
 * Nada aqui guarda segredo em claro: tokens de convite e códigos só existem como hash no banco.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { AppError } from '../application/context'
import { envValue, isProduction } from './env'

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url')

function secret(): string {
  const s = envValue('SESSION_SECRET')
  if (!s || s.length < 32) throw new AppError('SESSION_NOT_CONFIGURED', 'SESSION_SECRET ausente ou curto (mínimo 32 caracteres).', 503)
  return s
}

export interface SessionPayload {
  /** user = equipe Unità · supplier = fornecedor pelo link */
  kind: 'user' | 'supplier'
  /** id do usuário ou do convite */
  sub: string
  /** expiração (epoch em segundos) */
  exp: number
}

export function signSession(payload: SessionPayload): string {
  const body = b64url(JSON.stringify(payload))
  const sig = createHmac('sha256', secret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifySession(token: string | null | undefined, kind: SessionPayload['kind']): SessionPayload | null {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = createHmac('sha256', secret()).update(body).digest()
  const given = Buffer.from(sig, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload
    if (p.kind !== kind || typeof p.sub !== 'string' || p.exp * 1000 < Date.now()) return null
    return p
  } catch {
    return null
  }
}

export const sha256 = (v: string | Buffer) => createHash('sha256').update(v).digest('hex')
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')
/** Código numérico de 6 dígitos para confirmar o acesso do fornecedor. */
export const randomCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0')

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex')
  const y = Buffer.from(b, 'hex')
  return x.length === y.length && timingSafeEqual(x, y)
}

// ----------------------------------------------------------------------------- cookies

export const STAFF_COOKIE = 'forn_sess'
export const PORTAL_COOKIE = 'forn_portal'

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

export function setCookie(name: string, value: string, maxAgeSeconds: number): string {
  const secure = isProduction() || process.env.VERCEL === '1' ? '; Secure' : ''
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`
}

export const clearCookie = (name: string) => setCookie(name, '', 0)
