/**
 * Portas: o que os casos de uso precisam do mundo externo. As implementações ficam em infrastructure.
 */
import type { Db } from '../infrastructure/db/client'
import type { RequestContext } from './context'

export interface EmailMessage {
  to: string[]
  cc?: string[]
  subject: string
  html: string
  text: string
  requestId?: string | null
}

export interface Mailer {
  readonly provider: 'log' | 'graph' | 'none'
  send(message: EmailMessage): Promise<void>
}

export interface StoredFile {
  key: string
  size: number
}

export interface FileStorage {
  readonly kind: 'local' | 'vercel-blob'
  put(key: string, data: Buffer, mime: string): Promise<StoredFile>
  get(key: string): Promise<Buffer>
}

export interface UauCallResult {
  route: string
  status: number
  ok: boolean
  ms: number
  data: unknown
  /** true = rota de gravação não foi chamada (UAU_GRAVACAO=simulacao) */
  simulated?: boolean
}

export interface UauGateway {
  readonly writeEnabled: boolean
  call(route: string, body: unknown): Promise<UauCallResult>
  checkLogin(): Promise<number>
}

/** Dados públicos da empresa (Receita Federal via BrasilAPI). */
export interface CompanyData {
  cnpj: string
  razaoSocial: string
  nomeFantasia: string | null
  situacaoCadastral: string | null
  dataSituacao: string | null
  dataAbertura: string | null
  naturezaJuridica: string | null
  porte: string | null
  capitalSocial: number | null
  cnaePrincipal: { codigo: string; descricao: string } | null
  cnaesSecundarios: { codigo: string; descricao: string }[]
  simples: boolean | null
  mei: boolean | null
  email: string | null
  telefone: string | null
  endereco: { cep: string | null; logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; municipio: string | null; uf: string | null }
  socios: { nome: string; qualificacao: string | null }[]
  fonte: string
}

export interface CompanyLookup {
  find(cnpj: string): Promise<CompanyData | null>
}

export interface SanctionsLookup {
  readonly configured: boolean
  /** null = não consultado */
  ceis(cnpj: string): Promise<{ count: number; items: unknown[] } | null>
  cnep(cnpj: string): Promise<{ count: number; items: unknown[] } | null>
}

export interface UseCaseDeps {
  db: Db
  ctx: RequestContext
  readonly uau: UauGateway
  readonly mailer: Mailer
  readonly storage: FileStorage
  readonly company: CompanyLookup
  readonly sanctions: SanctionsLookup
}

/** Dependências do portal do fornecedor (sem usuário da equipe). */
export type PortalDeps = Omit<UseCaseDeps, 'ctx'> & { now: () => Date }
