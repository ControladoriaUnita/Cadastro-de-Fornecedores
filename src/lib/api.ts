/**
 * Cliente HTTP da API (/api/*). O navegador nunca fala com o UAU nem com o banco: só com o nosso servidor.
 * A sessão viaja em cookie HttpOnly; o cabeçalho X-Requested-With é a proteção contra CSRF.
 */
import type { ApiErrorBody } from '@shared/contracts'

/** Módulo da tela atual (o ModuleProvider atualiza). */
let currentModule: 'pj' | 'pf' = 'pj'
export const setApiModule = (m: 'pj' | 'pf') => {
  currentModule = m
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly correlationId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    // x-module: módulo da tela (os módulos são independentes; a API recorta as permissões por ele)
    headers: { 'x-requested-with': 'fornecedores', 'x-module': currentModule, ...(init.headers ?? {}) },
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok) {
    const e = (data as ApiErrorBody | null)?.error
    throw new ApiError(res.status, e?.code ?? 'HTTP', e?.message ?? `Erro ${res.status}`, e?.details, e?.correlationId)
  }
  return data as T
}

export function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  return request<T>(path, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

/** Envio de arquivo (multipart). */
export function upload<T>(path: string, fields: Record<string, string | Blob | null | undefined>): Promise<T> {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) if (v !== null && v !== undefined && v !== '') form.append(k, v)
  return request<T>(path, { method: 'POST', body: form })
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Erro inesperado.')

/** Bloqueios devolvidos pela API (ex.: o que falta para enviar à aprovação). */
export function errorBlockers(err: unknown): string[] {
  if (err instanceof ApiError && err.details && typeof err.details === 'object' && 'blockers' in err.details) {
    return (err.details as { blockers: string[] }).blockers
  }
  return []
}
