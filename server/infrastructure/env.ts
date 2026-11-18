/**
 * Leitura das variáveis de ambiente. Tolerante a erros comuns ao colar no painel da Vercel
 * (espaços, aspas e maiúsculas nas opções).
 */
export function envOption(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return (env[name] ?? '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .trim()
    .toLowerCase()
}

/** Valor de URL/chave sem espaços nem aspas em volta (null = ausente). Mantém maiúsculas. */
export function envValue(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const v = (env[name] ?? '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .trim()
  return v || null
}

export const isProduction = () => process.env.VERCEL_ENV === 'production'

/** Variáveis que o servidor usa, para o diagnóstico (só presença, nunca valores). */
const DIAGNOSTIC_VARS = [
  'AUTH_MODE',
  'SESSION_SECRET',
  'ENTRA_TENANT_ID',
  'ENTRA_CLIENT_ID',
  'ENTRA_CLIENT_SECRET',
  'DATABASE_URL',
  'UAU_MODE',
  'UAU_BASE_URL',
  'UAU_INTEGRATION_TOKEN',
  'UAU_LOGIN',
  'UAU_PASSWORD',
  'UAU_GRAVACAO',
  'EMAIL_PROVIDER',
  'GRAPH_TENANT_ID',
  'EMAIL_SENDER',
  'APP_URL',
  'BLOB_READ_WRITE_TOKEN',
  'TRANSPARENCIA_API_KEY',
] as const

export function envPresence(env: NodeJS.ProcessEnv = process.env): Record<string, boolean> {
  return Object.fromEntries(DIAGNOSTIC_VARS.map((k) => [k, !!env[k]?.trim()]))
}
