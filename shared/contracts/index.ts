/**
 * Contratos da API: esquemas de entrada (Zod, validados no servidor) e formatos de resposta (DTOs).
 * Front e back importam daqui, então uma mudança de formato quebra a compilação dos dois lados.
 */
import { z } from 'zod'
import { onlyDigits, personKindOf } from '../domain/document-number'
import type { ExpiryState, ReviewStatus } from '../domain/documents'
import type { RequestAction } from '../domain/request/workflow'
import { URGENCIES, type RequestStatus, type Urgency } from '../domain/request/status'
import type { SupplierScores } from '../domain/evaluation'
import { QUALIFICATION_ANSWERS, type QualificationItem } from '../domain/qualification'
import { RISK_RULE_KEYS, RISK_SEVERITIES, type RiskFinding, type RiskLevel, type RiskRuleDefinition, type RiskSeverity } from '../domain/risk'
import { ALL_PERMISSIONS, type Permission, type RoleKey } from '../domain/roles'
import { SUPPLIER_STATUSES, type SupplierStatus } from '../domain/supplier'

// ----------------------------------------------------------------------------- comuns

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; correlationId: string }
}

export const commentSchema = z.object({ comment: z.string().trim().min(1, 'Informe o motivo.').max(2000) })
export const optionalCommentSchema = z.object({ comment: z.string().trim().max(2000).optional() })
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
  .nullable()
  .optional()

export const documentNumberSchema = z
  .string()
  .transform(onlyDigits)
  .refine((v) => personKindOf(v) !== null, 'CNPJ ou CPF inválido')

// ----------------------------------------------------------------------------- sessão

export interface UserDTO {
  id: string
  fullName: string
  email: string
  roles: RoleKey[]
  roleNames: string[]
  permissions: Permission[]
}

export interface AuthConfigDTO {
  mode: 'dev' | 'entra'
  entraConfigured: boolean
}

export interface DevUserOption {
  id: string
  fullName: string
  roleNames: string[]
}

// ----------------------------------------------------------------------------- configuração

export interface DocumentTypeDTO {
  id: string
  name: string
  description: string | null
  hasExpiry: boolean
  defaultValidityDays: number | null
  active: boolean
  sort: number
}

export const documentTypeSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).nullable().optional(),
  hasExpiry: z.boolean(),
  defaultValidityDays: z.number().int().min(1).max(3650).nullable().optional(),
  active: z.boolean().default(true),
  sort: z.number().int().default(0),
})

export interface RequirementDTO {
  documentTypeId: string
  name: string
  description: string | null
  hasExpiry: boolean
  defaultValidityDays: number | null
  required: boolean
  instructions: string | null
}

export interface ModelDTO {
  id: string
  name: string
  description: string | null
  personKind: 'PJ' | 'PF' | 'ambos'
  expectedCnaePrefixes: string[]
  active: boolean
  requirements: RequirementDTO[]
}

export const modelSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).nullable().optional(),
  personKind: z.enum(['PJ', 'PF', 'ambos']),
  expectedCnaePrefixes: z.array(z.string().trim().regex(/^\d{2,7}$/, 'Prefixo de CNAE só com números')).max(30),
  active: z.boolean().default(true),
  requirements: z
    .array(
      z.object({
        documentTypeId: z.string().uuid(),
        required: z.boolean(),
        instructions: z.string().trim().max(300).nullable().optional(),
      }),
    )
    .max(40),
})

export interface CriterionDTO {
  id: string
  name: string
  description: string | null
  weight: number
  active: boolean
  sort: number
}

export const criterionSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200).nullable().optional(),
  weight: z.number().int().min(1).max(10),
  active: z.boolean().default(true),
  sort: z.number().int().default(0),
})

// ----------------------------------------------------------------------------- formulário de qualificação

export interface QualificationQuestionDTO {
  id: string
  text: string
  allowNa: boolean
  active: boolean
  sort: number
}

export const qualificationQuestionSchema = z.object({
  text: z.string().trim().min(3, 'Escreva a pergunta').max(200),
  allowNa: z.boolean().default(false),
  active: z.boolean().default(true),
  sort: z.number().int().default(0),
})

export interface QualificationDTO {
  items: (QualificationItem & { answeredByName: string | null; answeredAt: string | null })[]
  answered: number
  total: number
  complete: boolean
  /** Quando o PDF com as respostas foi anexado no UAU */
  uauAttachedAt: string | null
}

export const qualificationAnswersSchema = z.object({
  answers: z.array(z.object({ questionId: z.string().uuid(), answer: z.enum(QUALIFICATION_ANSWERS) })).min(1).max(100),
})

export interface RiskRuleDTO {
  key: (typeof RISK_RULE_KEYS)[number]
  definition: RiskRuleDefinition
  severity: RiskSeverity
  param: number | null
}

export const riskRuleUpdateSchema = z.object({
  rules: z.array(z.object({ key: z.enum(RISK_RULE_KEYS), severity: z.enum(RISK_SEVERITIES), param: z.number().min(0).nullable() })),
})

export interface TeamUserDTO {
  id: string
  fullName: string
  email: string
  roles: RoleKey[]
  active: boolean
  lastLoginAt: string | null
}

export const teamUserSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(120),
  roles: z.array(z.string().min(1).max(40)).min(1, 'Escolha ao menos um cargo').max(20),
  active: z.boolean().default(true),
})

export interface RoleDTO {
  key: RoleKey
  name: string
  description: string | null
  permissions: Permission[]
  /** Cargo de sistema (dev): sempre com todas as permissões, não pode ser apagado */
  system: boolean
  /** Quantos usuários têm o cargo */
  users: number
}

export const roleSchema = z.object({
  name: z.string().trim().min(2, 'Nome com ao menos 2 letras').max(60),
  description: z.string().trim().max(200).nullable().optional(),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])).max(ALL_PERMISSIONS.length),
})

// ----------------------------------------------------------------------------- empresa (Receita)

export interface CompanyDTO {
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

/** Resposta da busca de CNPJ/CPF em tempo real na abertura da solicitação. */
export interface DocumentLookupDTO {
  document: string
  personKind: 'PJ' | 'PF'
  company: CompanyDTO | null
  /** Falha ao consultar a Receita (null = consultou; company null sem erro = CNPJ não encontrado) */
  companyError: string | null
  /** Já existe no app */
  existing: { id: string; legalName: string; status: SupplierStatus; openRequestId: string | null; openRequestNumber: number | null } | null
  /** Já existe no UAU (consulta por CPF/CNPJ) */
  uau: { found: boolean; codPes: number | null; name: string | null; error: string | null }
}

// ----------------------------------------------------------------------------- solicitações

export const createRequestSchema = z.object({
  document: documentNumberSchema,
  /** Opcional: no pré-cadastro da Obra, Suprimentos escolhe na triagem */
  modelId: z.string().uuid('Escolha o modelo de fornecedor').nullable().optional(),
  contactEmail: z.string().trim().toLowerCase().email('E-mail do fornecedor inválido').max(120),
  contactName: z.string().trim().max(80).nullable().optional(),
  workName: z.string().trim().max(120).nullable().optional(),
  justification: z.string().trim().max(1000).nullable().optional(),
  urgency: z.enum(URGENCIES).default('normal'),
  /** Já envia o convite ao criar (exige permissão de análise) */
  sendInvite: z.boolean().default(false),
})
export type CreateRequestInput = z.infer<typeof createRequestSchema>

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(120).optional(),
  /** Modelo escolhido na triagem (obrigatório se a solicitação ainda não tem) */
  modelId: z.string().uuid().optional(),
  message: z.string().trim().max(1000).nullable().optional(),
})

export interface RequestCardDTO {
  id: string
  number: number
  status: RequestStatus
  urgency: Urgency
  supplierId: string
  supplierName: string
  document: string
  modelName: string | null
  requesterName: string
  workName: string | null
  riskLevel: RiskLevel
  docs: { approved: number; required: number }
  createdAt: string
  updatedAt: string
}

export interface EventDTO {
  id: string
  at: string
  actorLabel: string
  kind: string
  fromStatus: RequestStatus | null
  toStatus: RequestStatus | null
  comment: string | null
  payload: Record<string, unknown> | null
}

export interface DocumentDTO {
  id: string
  documentTypeId: string
  documentTypeName: string
  fileName: string
  mime: string
  size: number
  uploadedBy: 'supplier' | 'user'
  issuedAt: string | null
  expiresAt: string | null
  expiry: ExpiryState
  reviewStatus: ReviewStatus
  reviewNote: string | null
  reviewedByName: string | null
  reviewedAt: string | null
  replaced: boolean
  uauAttachedAt: string | null
  createdAt: string
}

export const reviewDocumentSchema = z.object({
  status: z.enum(['aprovado', 'reprovado']),
  note: z.string().trim().max(500).nullable().optional(),
  issuedAt: isoDate,
  expiresAt: isoDate,
})

export interface RiskCheckDTO {
  id: string
  ranAt: string
  ranByName: string | null
  level: RiskLevel
  blocked: boolean
  findings: RiskFinding[]
  sources: Record<string, unknown>
}

export interface ChecklistDTO {
  complete: boolean
  missing: string[]
  pendingReview: string[]
  rejected: string[]
  expired: string[]
}

export interface InviteDTO {
  email: string
  expiresAt: string
  lastAccessAt: string | null
  verifiedAt: string | null
  createdAt: string
  active: boolean
}

export interface RequestDetailDTO {
  id: string
  number: number
  status: RequestStatus
  urgency: Urgency
  workName: string | null
  justification: string | null
  contactEmail: string
  contactName: string | null
  requester: { id: string; fullName: string }
  createdAt: string
  updatedAt: string
  supplierSubmittedAt: string | null
  uauSimulated: boolean | null
  uauResult: Record<string, unknown> | null
  supplier: SupplierDetailDTO
  /** null = pré-cadastro ainda sem modelo (Suprimentos define na triagem) */
  model: ModelDTO | null
  /** Formulário de qualificação respondido por Suprimentos */
  qualification: QualificationDTO
  documents: DocumentDTO[]
  checklist: ChecklistDTO
  latestRisk: RiskCheckDTO | null
  invite: InviteDTO | null
  events: EventDTO[]
  actions: RequestAction[]
}

/** Prévia do que será gravado no UAU (tela de validação). */
export interface UauPreviewDTO {
  writeEnabled: boolean
  duplicate: { found: boolean; codPes: number | null; name: string | null; error: string | null }
  profileErrors: { path: string; message: string }[]
  steps: { route: string; description: string; body: unknown }[]
  attachments: { documentId: string; fileName: string; documentTypeName: string }[]
}

// ----------------------------------------------------------------------------- fornecedores

export interface SupplierListItemDTO {
  id: string
  document: string
  personKind: 'PJ' | 'PF'
  legalName: string
  tradeName: string | null
  status: SupplierStatus
  riskLevel: RiskLevel
  modelName: string | null
  uauCodPes: number | null
  source: 'app' | 'uau'
  /** Média geral (todas as avaliações) */
  average: number | null
  evaluations: number
  /** Média do mês corrente */
  monthAverage: number | null
  monthEvaluations: number
  docsExpiring: number
  docsExpired: number
  updatedAt: string
}

export interface EvaluationDTO {
  id: string
  workName: string
  reference: string | null
  evaluatorName: string
  scores: Record<string, number>
  average: number | null
  comment: string | null
  createdAt: string
}

export interface SupplierDetailDTO {
  id: string
  document: string
  personKind: 'PJ' | 'PF'
  legalName: string
  tradeName: string | null
  email: string | null
  status: SupplierStatus
  modelId: string | null
  modelName: string | null
  profile: Record<string, unknown>
  receita: CompanyDTO | null
  receitaCheckedAt: string | null
  riskLevel: RiskLevel
  riskCheckedAt: string | null
  uauCodPes: number | null
  uauSyncedAt: string | null
  source: 'app' | 'uau'
  createdAt: string
  updatedAt: string
}

export interface SupplierFullDTO {
  supplier: SupplierDetailDTO
  documents: DocumentDTO[]
  riskChecks: RiskCheckDTO[]
  evaluations: EvaluationDTO[]
  criteria: CriterionDTO[]
  /** Média geral (= scores.overall) */
  average: number | null
  /** Média geral, média do mês e histórico dos últimos 12 meses */
  scores: SupplierScores
  requests: { id: string; number: number; status: RequestStatus; createdAt: string }[]
}

export const supplierUpdateSchema = z.object({
  status: z.enum(SUPPLIER_STATUSES).optional(),
  modelId: z.string().uuid().nullable().optional(),
  email: z.string().trim().toLowerCase().email().max(120).nullable().optional(),
})

export const importFromUauSchema = z.object({
  documents: z.array(documentNumberSchema).min(1).max(50),
})

/** Importação da base inteira do UAU, em etapas: o navegador chama de novo com `from` até `done`. */
export const uauSyncSchema = z.object({
  from: z.number().int().min(0).max(200_000),
  emptyStreak: z.number().int().min(0).max(200_000).default(0),
})

export interface UauSyncDTO {
  /** Próximo código de pessoa a ler */
  from: number
  emptyStreak: number
  done: boolean
  /** Contagens só desta etapa (o navegador soma) */
  read: number
  created: number
  updated: number
  skipped: { pessoa_fisica: number; inativa: number; invalida: number; duplicada: number }
}

export interface ImportResultDTO {
  results: { document: string; outcome: 'importado' | 'ja_existe' | 'nao_encontrado' | 'erro'; message: string; supplierId: string | null }[]
}

/** Fornecedor que pode ser avaliado (busca da tela "Avaliar"): só o essencial, sem documentos nem risco. */
export interface EvaluableSupplierDTO {
  id: string
  legalName: string
  tradeName: string | null
  document: string
}

/** Avaliação feita pelo próprio usuário (tela "Avaliar"). */
export interface MyEvaluationDTO {
  id: string
  supplierId: string
  supplierName: string
  workName: string
  reference: string | null
  average: number | null
  createdAt: string
}

export const evaluationSchema = z.object({
  supplierId: z.string().uuid(),
  workName: z.string().trim().min(2, 'Informe a obra').max(120),
  reference: z.string().trim().max(80).nullable().optional(),
  scores: z.record(z.string().uuid(), z.number().int().min(1).max(5)),
  comment: z.string().trim().max(1000).nullable().optional(),
})

// ----------------------------------------------------------------------------- painel

export interface DashboardDTO {
  suppliers: { total: number; homologado: number; em_cadastro: number; bloqueado: number; inativo: number }
  requests: { open: number; byStatus: Record<RequestStatus, number>; avgDaysToApprove: number | null; createdLast30: number; approvedLast30: number }
  risk: Record<RiskLevel, number>
  documents: { expiring: number; expired: number }
  expiringList: { supplierId: string; supplierName: string; documentTypeName: string; expiresAt: string; expiry: ExpiryState }[]
  /** Mês das médias mensais ("2026-11", horário de Brasília) */
  ratingMonth: string
  /** 5 maiores e 5 menores médias gerais */
  topRated: RatedSupplierDTO[]
  worstRated: RatedSupplierDTO[]
}

export interface RatedSupplierDTO {
  supplierId: string
  supplierName: string
  /** Média de todas as avaliações */
  overall: number
  overallCount: number
  /** Média das avaliações do mês corrente */
  month: number | null
  monthCount: number
}

// ----------------------------------------------------------------------------- portal do fornecedor

export const portalCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Código com 6 dígitos') })

export interface PortalStateDTO {
  stage: 'needs_code' | 'ready'
  /** E-mail mascarado para onde o código foi/será enviado */
  emailHint: string
  companyName: string
}

export interface PortalDataDTO {
  requestNumber: number
  status: RequestStatus
  canEdit: boolean
  personKind: 'PJ' | 'PF'
  document: string
  modelName: string
  pendingNote: string | null
  profile: Record<string, unknown>
  requirements: RequirementDTO[]
  documents: DocumentDTO[]
  submittedAt: string | null
}

export const portalProfileSchema = z.object({ profile: z.record(z.unknown()) })

// ----------------------------------------------------------------------------- dev

export interface DiagnosticsDTO {
  env: Record<string, boolean>
  authMode: 'dev' | 'entra'
  uau: { mode: 'real' | 'mock'; writeEnabled: boolean; login: { ok: boolean; ms: number | null; error: string | null } }
  database: { ok: boolean; ms: number | null; error: string | null }
  email: { provider: string }
  storage: { kind: string }
  transparencia: { configured: boolean }
}

export interface OutboxItemDTO {
  id: string
  to: string[]
  subject: string
  text: string
  html: string
  provider: string
  status: string
  error: string | null
  createdAt: string
}
