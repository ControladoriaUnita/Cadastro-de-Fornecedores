/**
 * Cliente HTTP da API UAU (Globaltec/Senior). Roda só no servidor: credenciais e token
 * nunca vão ao navegador, ao banco nem aos logs. (Mesmo desenho do app de Insumos.)
 *
 *  - Autenticação: Autenticador/AutenticarUsuario → token em cache por 59 minutos;
 *    chamadas simultâneas compartilham o mesmo login; HTTP 401 renova o token uma vez.
 *  - Toda rota é POST em <base>/api/v1.0/<Controller>/<Metodo> com X-INTEGRATION-Authorization.
 *  - Rotas que gravam só são chamadas com UAU_GRAVACAO=real; em simulação devolvem `simulated: true`.
 */
import { IntegrationError } from '../../application/context'
import type { UauCallResult, UauGateway } from '../../application/ports'

export interface UauConfig {
  baseUrl: string
  integrationToken: string
  login: string
  password: string
  writeEnabled: boolean
}

// Rotas de consulta começam com estes verbos; qualquer outra altera dados reais do UAU.
const READ_PREFIXES = ['Consultar', 'Obter', 'Buscar', 'Exportar', 'Retornar', 'Listar', 'Lista']

export function isReadRoute(route: string): boolean {
  const action = route.split('/').pop() ?? ''
  return READ_PREFIXES.some((p) => action.startsWith(p))
}

const TOKEN_TTL_MS = 59 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 90_000

export class UauClient implements UauGateway {
  private token: string | null = null
  private tokenExpiresAt = 0
  private pendingLogin: Promise<string> | null = null

  constructor(private readonly config: UauConfig) {}

  get writeEnabled() {
    return this.config.writeEnabled
  }

  async call(route: string, body: unknown): Promise<UauCallResult> {
    if (!/^[A-Za-z]+\/[A-Za-z0-9]+$/.test(route) || /^Autenticador\//i.test(route)) {
      throw new IntegrationError(`Rota UAU inválida: ${route}`)
    }
    if (!isReadRoute(route) && !this.config.writeEnabled) {
      log(`${route} → simulado (UAU_GRAVACAO=simulacao)`)
      return { route, status: 0, ok: true, ms: 0, data: null, simulated: true }
    }
    const started = Date.now()
    let res = await this.post(route, body, await this.getToken())
    if (res.status === 401) {
      this.token = null
      res = await this.post(route, body, await this.getToken())
    }
    const ms = Date.now() - started
    log(`${route} → HTTP ${res.status} em ${ms} ms`)
    return { route, status: res.status, ok: res.status >= 200 && res.status < 300, ms, data: normalize(res.data) }
  }

  async checkLogin(): Promise<number> {
    const started = Date.now()
    this.token = null
    await this.getToken()
    return Date.now() - started
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token
    this.pendingLogin ??= this.authenticate().finally(() => {
      this.pendingLogin = null
    })
    return this.pendingLogin
  }

  private async authenticate(): Promise<string> {
    const res = await this.post('Autenticador/AutenticarUsuario', { Login: this.config.login, Senha: this.config.password })
    log(`login → HTTP ${res.status}`)
    if (res.status !== 200 || typeof res.data !== 'string' || !res.data.trim()) {
      const reason = res.data && typeof res.data === 'object' ? String((res.data as Record<string, unknown>).Descricao ?? '') : ''
      throw new IntegrationError(`O UAU recusou o login (HTTP ${res.status}). ${reason}`.trim())
    }
    this.token = res.data.trim()
    this.tokenExpiresAt = Date.now() + TOKEN_TTL_MS
    return this.token
  }

  private async post(route: string, body: unknown, token?: string): Promise<{ status: number; data: unknown }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-INTEGRATION-Authorization': this.config.integrationToken,
    }
    if (token) headers.Authorization = token
    try {
      const res = await fetch(`${this.config.baseUrl.replace(/\/+$/, '')}/api/v1.0/${route}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      })
      const text = await res.text()
      try {
        return { status: res.status, data: JSON.parse(text) }
      } catch {
        return { status: res.status, data: text }
      }
    } catch (err) {
      const message = describeNetworkError(err)
      log(`${route} → falhou: ${message}`, 'warn')
      throw new IntegrationError(message)
    }
  }
}

/** Uma linha por chamada nos logs do servidor. Nunca inclui corpo ou credenciais. */
function log(message: string, level: 'info' | 'warn' = 'info') {
  console[level](`[uau] ${message}`)
}

export function describeNetworkError(err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } }
  const code = e?.cause?.code ?? ''
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'O UAU não respondeu a tempo. Tente de novo.'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Endereço do UAU não encontrado. Confira UAU_BASE_URL.'
  if (code === 'ECONNREFUSED') return 'O servidor do UAU recusou a conexão.'
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') return 'Sem conexão com o UAU (possível bloqueio por IP).'
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'O UAU encerrou a conexão no meio.'
  return `Falha de rede ao chamar o UAU: ${code || e?.cause?.message || e?.message || 'erro desconhecido'}.`
}

/*
 * O UAU responde em dois formatos: lista simples ou "DataSet" [{ MyTable: [linhaDeTipos, ...linhas] }],
 * em que a linha de tipos tem valores "System.String, mscorlib, ..." e nulos vêm como "null".
 */
const isTypeRow = (row: unknown) =>
  !!row && typeof row === 'object' && Object.values(row).some((v) => typeof v === 'string' && v.includes(', mscorlib'))

export function normalize(data: unknown): unknown {
  if (!Array.isArray(data)) return data
  let rows: unknown[] = data
  const first = rows[0]
  if (rows.length === 1 && first && typeof first === 'object' && !Array.isArray(first)) {
    const values = Object.values(first)
    if (values.length === 1 && Array.isArray(values[0])) rows = values[0]
  }
  if (isTypeRow(rows[0])) rows = rows.slice(1)
  return rows.map((row) =>
    row && typeof row === 'object' ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === 'null' ? null : v])) : row,
  )
}

/** Acha a lista de registros em qualquer resposta. */
export function extractRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    const rows = normalize(data) as unknown[]
    if (rows.length === 1 && rows[0] && typeof rows[0] === 'object' && !Array.isArray(rows[0])) {
      const inner = extractRows(rows[0])
      if (inner.length) return inner
    }
    return rows.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
  }
  if (!data || typeof data !== 'object') return []
  let best: Record<string, unknown>[] = []
  for (const v of Object.values(data)) {
    if (!Array.isArray(v)) continue
    const inner = extractRows(v)
    if (inner.length > best.length) best = inner
  }
  return best
}
