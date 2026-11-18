/**
 * Schema do banco (Neon / PostgreSQL). Alterou aqui? Rode `npm run db:generate` e depois `npm run db:migrate`.
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

const id = () => uuid('id').primaryKey().defaultRandom()
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()

// ----------------------------------------------------------------------------- equipe

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  fullName: text('full_name').notNull(),
  roles: text('roles').array().notNull().default(sql`'{}'::text[]`),
  active: boolean('active').notNull().default(true),
  /** Object ID do Microsoft Entra (preenchido no primeiro login) */
  entraOid: text('entra_oid').unique(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
})

/** Cargos: conjuntos de permissões editáveis no Painel dev (users.roles guarda as chaves). */
export const roles = pgTable('roles', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  permissions: text('permissions').array().notNull().default(sql`'{}'::text[]`),
  /** Cargo de sistema (dev): não pode ser apagado nem perder permissões */
  system: boolean('system').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

// ----------------------------------------------------------------------------- configuração (perfil dev)

export const documentTypes = pgTable('document_types', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  hasExpiry: boolean('has_expiry').notNull().default(false),
  /** Validade padrão quando o documento não traz data (ex.: certidões de 30/90/180 dias) */
  defaultValidityDays: integer('default_validity_days'),
  active: boolean('active').notNull().default(true),
  sort: integer('sort').notNull().default(0),
  createdAt: createdAt(),
})

export const supplierModels = pgTable('supplier_models', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  /** PJ, PF ou ambos */
  personKind: text('person_kind').notNull().default('PJ'),
  /** Prefixos de CNAE esperados (vazio = sem restrição) */
  expectedCnaePrefixes: text('expected_cnae_prefixes').array().notNull().default(sql`'{}'::text[]`),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const modelRequirements = pgTable(
  'model_requirements',
  {
    id: id(),
    modelId: uuid('model_id').notNull().references(() => supplierModels.id, { onDelete: 'cascade' }),
    documentTypeId: uuid('document_type_id').notNull().references(() => documentTypes.id),
    required: boolean('required').notNull().default(true),
    instructions: text('instructions'),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [uniqueIndex('model_requirements_unique').on(t.modelId, t.documentTypeId)],
)

export const evaluationCriteria = pgTable('evaluation_criteria', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  weight: integer('weight').notNull().default(1),
  active: boolean('active').notNull().default(true),
  sort: integer('sort').notNull().default(0),
  createdAt: createdAt(),
})

export const riskRuleConfigs = pgTable('risk_rule_configs', {
  key: text('key').primaryKey(),
  severity: text('severity').notNull(),
  param: numeric('param', { mode: 'number' }),
  updatedAt: updatedAt(),
  updatedBy: uuid('updated_by').references(() => users.id),
})

// ----------------------------------------------------------------------------- fornecedores

export const suppliers = pgTable(
  'suppliers',
  {
    id: id(),
    /** CNPJ ou CPF, só dígitos */
    document: text('document').notNull().unique(),
    personKind: text('person_kind').notNull(),
    legalName: text('legal_name').notNull(),
    tradeName: text('trade_name'),
    email: text('email'),
    status: text('status').notNull().default('em_cadastro'),
    modelId: uuid('model_id').references(() => supplierModels.id),
    /** Ficha preenchida (SupplierProfile; pode estar incompleta enquanto em cadastro) */
    profile: jsonb('profile').$type<Record<string, unknown>>().notNull().default({}),
    /** Última consulta à Receita (resposta normalizada) */
    receita: jsonb('receita').$type<Record<string, unknown>>(),
    receitaCheckedAt: timestamp('receita_checked_at', { withTimezone: true }),
    riskLevel: text('risk_level').notNull().default('nao_avaliado'),
    riskCheckedAt: timestamp('risk_checked_at', { withTimezone: true }),
    uauCodPes: integer('uau_cod_pes'),
    uauSyncedAt: timestamp('uau_synced_at', { withTimezone: true }),
    /** app = cadastrado por aqui · uau = importado da base existente */
    source: text('source').notNull().default('app'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('suppliers_status_idx').on(t.status)],
)

export const requests = pgTable(
  'requests',
  {
    id: id(),
    number: serial('number').notNull().unique(),
    supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
    modelId: uuid('model_id').notNull().references(() => supplierModels.id),
    requesterId: uuid('requester_id').notNull().references(() => users.id),
    analystId: uuid('analyst_id').references(() => users.id),
    status: text('status').notNull().default('solicitado'),
    urgency: text('urgency').notNull().default('normal'),
    /** Obra / centro de custo que precisa do fornecedor */
    workName: text('work_name'),
    justification: text('justification'),
    /** E-mail para onde vai o convite */
    contactEmail: text('contact_email').notNull(),
    contactName: text('contact_name'),
    supplierSubmittedAt: timestamp('supplier_submitted_at', { withTimezone: true }),
    /** Resultado da gravação no UAU (rotas chamadas, respostas, simulação) */
    uauResult: jsonb('uau_result').$type<Record<string, unknown>>(),
    uauSimulated: boolean('uau_simulated'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [index('requests_status_idx').on(t.status), index('requests_supplier_idx').on(t.supplierId)],
)

/** Histórico append-only de cada solicitação. */
export const requestEvents = pgTable(
  'request_events',
  {
    id: id(),
    requestId: uuid('request_id').notNull().references(() => requests.id, { onDelete: 'cascade' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid('actor_id').references(() => users.id),
    actorLabel: text('actor_label').notNull(),
    kind: text('kind').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    comment: text('comment'),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
  },
  (t) => [index('request_events_request_idx').on(t.requestId)],
)

/** Link do fornecedor: token (só o hash fica no banco) + código por e-mail. */
export const invites = pgTable(
  'invites',
  {
    id: id(),
    requestId: uuid('request_id').notNull().references(() => requests.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    codeHash: text('code_hash'),
    codeExpiresAt: timestamp('code_expires_at', { withTimezone: true }),
    codeAttempts: integer('code_attempts').notNull().default(0),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    lastAccessAt: timestamp('last_access_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('invites_request_idx').on(t.requestId)],
)

export const documents = pgTable(
  'documents',
  {
    id: id(),
    supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
    requestId: uuid('request_id').references(() => requests.id),
    documentTypeId: uuid('document_type_id').notNull().references(() => documentTypes.id),
    fileName: text('file_name').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    storageKey: text('storage_key').notNull(),
    sha256: text('sha256').notNull(),
    uploadedBy: text('uploaded_by').notNull(),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id),
    issuedAt: date('issued_at'),
    expiresAt: date('expires_at'),
    reviewStatus: text('review_status').notNull().default('pendente'),
    reviewNote: text('review_note'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /** Substituído por um envio mais novo do mesmo tipo */
    replacedAt: timestamp('replaced_at', { withTimezone: true }),
    uauAttachedAt: timestamp('uau_attached_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('documents_supplier_idx').on(t.supplierId), index('documents_expires_idx').on(t.expiresAt)],
)

export const riskChecks = pgTable(
  'risk_checks',
  {
    id: id(),
    supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
    requestId: uuid('request_id').references(() => requests.id),
    ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
    ranBy: uuid('ran_by').references(() => users.id),
    level: text('level').notNull(),
    blocked: boolean('blocked').notNull(),
    findings: jsonb('findings').$type<unknown[]>().notNull(),
    facts: jsonb('facts').$type<Record<string, unknown>>().notNull(),
    sources: jsonb('sources').$type<Record<string, unknown>>().notNull(),
  },
  (t) => [index('risk_checks_supplier_idx').on(t.supplierId)],
)

export const evaluations = pgTable(
  'evaluations',
  {
    id: id(),
    supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
    evaluatorId: uuid('evaluator_id').notNull().references(() => users.id),
    workName: text('work_name').notNull(),
    reference: text('reference'),
    scores: jsonb('scores').$type<Record<string, number>>().notNull(),
    average: numeric('average', { mode: 'number' }),
    comment: text('comment'),
    createdAt: createdAt(),
  },
  (t) => [index('evaluations_supplier_idx').on(t.supplierId)],
)

/** Todo e-mail que o app tenta enviar (com EMAIL_PROVIDER=log, é aqui que ele aparece). */
export const emailOutbox = pgTable('email_outbox', {
  id: id(),
  to: text('to').array().notNull(),
  subject: text('subject').notNull(),
  html: text('html').notNull(),
  text: text('text').notNull(),
  provider: text('provider').notNull(),
  status: text('status').notNull(),
  error: text('error'),
  requestId: uuid('request_id').references(() => requests.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
})
