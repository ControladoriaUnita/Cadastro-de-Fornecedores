/**
 * Contexto de execução de um caso de uso + erros de aplicação.
 */
import { WorkflowError } from '../../shared/domain/request/workflow'
import type { Permission, RoleKey } from '../../shared/domain/roles'

export interface Actor {
  id: string
  fullName: string
  email: string
  roles: RoleKey[]
  /** Nomes dos cargos, para exibir */
  roleNames: string[]
  permissions: Permission[]
}

export interface RequestContext {
  correlationId: string
  actor: Actor
  now: () => Date
}

export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

/** Falha ao falar com um sistema externo (UAU, Receita, Microsoft). A mensagem é segura para o usuário. */
export class IntegrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntegrationError'
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} não encontrado(a).`, 404)

export function can(actor: Actor, permission: Permission): boolean {
  return actor.permissions.includes(permission)
}

/** Exige ao menos uma das permissões. */
export function requirePermission(actor: Actor, ...anyOf: Permission[]): void {
  if (!anyOf.some((p) => can(actor, p))) {
    throw new AppError('FORBIDDEN', 'Seu perfil não tem acesso a esta operação.', 403, { required: anyOf })
  }
}

/** Converte erros de domínio/infraestrutura em AppError com status HTTP coerente. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err
  if (err instanceof WorkflowError) {
    const status = err.code === 'FORBIDDEN' ? 403 : err.code === 'COMMENT_REQUIRED' ? 422 : 409
    return new AppError(err.code, err.message, status)
  }
  if (err instanceof IntegrationError) return new AppError('INTEGRATION', err.message, 502)
  if (err instanceof Error && err.name === 'TimeoutError') {
    return new AppError('TIMEOUT', 'Um sistema externo demorou demais para responder. Tente de novo em instantes.', 504)
  }
  const msg = err instanceof Error ? err.message : String(err)
  if (/duplicate key value.*suppliers_document/i.test(msg)) {
    return new AppError('DUPLICATE_SUPPLIER', 'Já existe um fornecedor com este CNPJ/CPF.', 409)
  }
  return new AppError('INTERNAL', 'Erro inesperado. Tente novamente.', 500)
}
