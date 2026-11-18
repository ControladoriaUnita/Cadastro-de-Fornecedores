/**
 * Escolhe o gateway do UAU:
 *   UAU_MODE=real (padrão) → API de verdade (consultas sempre; gravação só com UAU_GRAVACAO=real)
 *   UAU_MODE=mock          → respostas simuladas, sem rede (testes e demonstração)
 */
import { AppError } from '../../application/context'
import type { UauCallResult, UauGateway } from '../../application/ports'
import { envOption, envValue } from '../env'
import { isReadRoute, UauClient } from './uau-client'

export const uauMode = (): 'real' | 'mock' => (envOption('UAU_MODE') === 'mock' ? 'mock' : 'real')
export const uauWriteEnabled = () => envOption('UAU_GRAVACAO') === 'real'

class MockUau implements UauGateway {
  readonly writeEnabled = true
  private nextCode = 90000
  async call(route: string): Promise<UauCallResult> {
    const data = route.endsWith('GravarPessoa') ? [{ cod_pes: this.nextCode++ }] : isReadRoute(route) ? [] : { ok: true }
    return { route, status: 200, ok: true, ms: 5, data }
  }
  async checkLogin() {
    return 0
  }
}

let instance: UauGateway | null = null

export function getUauGateway(): UauGateway {
  if (instance) return instance
  if (uauMode() === 'mock') return (instance = new MockUau())
  const cfg = {
    baseUrl: envValue('UAU_BASE_URL'),
    integrationToken: envValue('UAU_INTEGRATION_TOKEN'),
    login: envValue('UAU_LOGIN'),
    password: envValue('UAU_PASSWORD'),
  }
  const missing = Object.entries(cfg)
    .filter(([, v]) => !v)
    .map(([k]) => k)
  if (missing.length) throw new AppError('UAU_NOT_CONFIGURED', `UAU sem configuração no servidor: ${missing.join(', ')}.`, 503)
  return (instance = new UauClient({ ...(cfg as Record<keyof typeof cfg, string>), writeEnabled: uauWriteEnabled() }))
}

/** Usuário gravado como "cadastrado por" no UAU. */
export const uauUser = () => envValue('UAU_USUARIO_CADASTRO') ?? envValue('UAU_LOGIN') ?? 'API'
export const uauAttachmentFolder = () => envValue('UAU_PASTA_ANEXOS') ?? 'FORNECEDORES'
