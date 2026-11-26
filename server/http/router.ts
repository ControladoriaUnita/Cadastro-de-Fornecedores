/**
 * Camada HTTP (controllers finos): Request → validação → caso de uso → Response.
 * Uma única Vercel Function (api/router.ts) atende todas as rotas /api/*.
 *
 * Segurança:
 *  - sessão em cookie HttpOnly assinado (equipe: forn_sess · fornecedor: forn_portal)
 *  - toda requisição que altera dados exige o cabeçalho X-Requested-With (barra CSRF entre sites)
 *  - entradas validadas com Zod; erros internos nunca vazam detalhes
 */
import { eq } from 'drizzle-orm'
import { z, ZodError, type ZodTypeAny } from 'zod'
import {
  commentSchema,
  createRequestSchema,
  criterionSchema,
  documentNumberSchema,
  documentTypeSchema,
  evaluationSchema,
  importFromUauSchema,
  qualificationAnswersSchema,
  qualificationQuestionSchema,
  workSchema,
  uauSyncSchema,
  inviteSchema,
  modelSchema,
  optionalCommentSchema,
  portalCodeSchema,
  portalProfileSchema,
  reviewDocumentSchema,
  riskRuleUpdateSchema,
  supplierUpdateSchema,
  roleSchema,
  teamUserSchema,
  type ApiErrorBody,
  type AuthConfigDTO,
  type UserDTO,
} from '../../shared/contracts'
import { PERMISSIONS } from '../../shared/domain/roles'
import { AppError, requirePermission, toAppError, type RequestContext } from '../application/context'
import type { PortalDeps, UseCaseDeps } from '../application/ports'
import { readDocumentFile } from '../application/shared'
import { isModule, moduleOfKind, type Module } from '../../shared/domain/modules'
import * as approval from '../application/use-cases/approval'
import { getDashboard } from '../application/use-cases/dashboard'
import * as dev from '../application/use-cases/dev'
import * as portal from '../application/use-cases/portal'
import * as qualification from '../application/use-cases/qualification'
import * as requests from '../application/use-cases/requests'
import * as settings from '../application/use-cases/settings'
import * as suppliersUC from '../application/use-cases/suppliers'
import * as works from '../application/use-cases/works'
import { authMode, devLoginAllowed, entraAuthorizeUrl, entraCallback, entraConfigured, issueStaffSession, loadActor, loadRoleCatalog } from '../infrastructure/auth'
import { getDb, schema } from '../infrastructure/db/client'
import { createMailer } from '../infrastructure/email'
import { findCep, PublicCompanyLookup } from '../infrastructure/external/company-lookup'
import { TransparenciaSanctions } from '../infrastructure/external/sanctions-lookup'
import { envPresence } from '../infrastructure/env'
import { clearCookie, PORTAL_COOKIE, readCookie, setCookie, STAFF_COOKIE, verifySession } from '../infrastructure/security'
import { getStorage } from '../infrastructure/storage'
import { getUauGateway } from '../infrastructure/uau'

// ----------------------------------------------------------------------------- tipos e utilitários

interface Ctx {
  req: Request
  url: URL
  params: Record<string, string>
  json: () => Promise<unknown>
  form: () => Promise<FormData>
}
type StaffHandler = (deps: UseCaseDeps, c: Ctx) => Promise<unknown>
type PortalHandler = (deps: PortalDeps, inviteId: string, c: Ctx) => Promise<unknown>
type PublicHandler = (c: Ctx) => Promise<unknown>

/**
 * Módulo de uma requisição da equipe (os módulos são independentes: as permissões valem só nele).
 *   'pj'/'pf' fixo · função que descobre pelo registro (solicitação, cadastro, documento) ·
 *   padrão: ?module= ou cabeçalho x-module enviado pela tela.
 */
type ModuleResolver = Module | ((c: Ctx) => Promise<Module>)

interface Route {
  method: string
  pattern: RegExp
  keys: string[]
  kind: 'staff' | 'portal' | 'public'
  handler: StaffHandler | PortalHandler | PublicHandler
  status: number
  module?: ModuleResolver
}

const routes: Route[] = []
function add(kind: Route['kind'], method: string, path: string, handler: Route['handler'], status = 200, module?: ModuleResolver) {
  const keys: string[] = []
  const pattern = new RegExp('^' + path.replace(/:(\w+)/g, (_, k: string) => (keys.push(k), '([^/]+)')) + '/?$')
  routes.push({ method, pattern, keys, kind, handler, status, module })
}
const staff = (m: string, p: string, h: StaffHandler, s?: number, module?: ModuleResolver) => add('staff', m, p, h, s, module)

// Módulo pelo registro: CNPJ = Fornecedores/PJ, CPF = Pessoas Físicas/PF
const kindModule = (kind: string | undefined): Module => {
  if (!kind) throw new AppError('NOT_FOUND', 'Registro não encontrado.', 404)
  return moduleOfKind(kind)
}
const byRequest: ModuleResolver = async (c) => {
  const [r] = await getDb()
    .select({ kind: schema.suppliers.personKind })
    .from(schema.requests)
    .innerJoin(schema.suppliers, eq(schema.suppliers.id, schema.requests.supplierId))
    .where(eq(schema.requests.id, id(c)))
  return kindModule(r?.kind)
}
const bySupplier: ModuleResolver = async (c) => {
  const [s] = await getDb().select({ kind: schema.suppliers.personKind }).from(schema.suppliers).where(eq(schema.suppliers.id, id(c)))
  return kindModule(s?.kind)
}
const byDocument: ModuleResolver = async (c) => {
  const [d] = await getDb()
    .select({ kind: schema.suppliers.personKind })
    .from(schema.documents)
    .innerJoin(schema.suppliers, eq(schema.suppliers.id, schema.documents.supplierId))
    .where(eq(schema.documents.id, id(c)))
  return kindModule(d?.kind)
}
const byLookup: ModuleResolver = async (c) => (String(c.params.document ?? '').replace(/\D/g, '').length === 11 ? 'pf' : 'pj')
const byBodyModule: ModuleResolver = async (c) => {
  const m = ((await c.json()) as { module?: unknown } | null)?.module ?? 'pj'
  if (!isModule(m)) throw new AppError('INVALID_MODULE', 'Módulo inválido.', 400)
  return m
}
const portalRoute = (m: string, p: string, h: PortalHandler, s?: number) => add('portal', m, p, h, s)
const pub = (m: string, p: string, h: PublicHandler, s?: number) => add('public', m, p, h, s)

const parse = <S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> => schema.parse(data)
const uuid = z.string().uuid()
const id = (c: Ctx, key = 'id') => parse(uuid, c.params[key])
const isoDateOrNull = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()

/** Lê o formulário de upload: arquivo + tipo de documento + datas opcionais. */
async function uploadForm(c: Ctx) {
  const f = await c.form()
  const file = f.get('file')
  if (!(file instanceof File)) throw new AppError('FILE_REQUIRED', 'Selecione um arquivo.', 422)
  const date = (k: string) => parse(isoDateOrNull, (f.get(k) as string | null) || null)
  return { file, documentTypeId: parse(uuid, f.get('documentTypeId')), issuedAt: date('issuedAt'), expiresAt: date('expiresAt') }
}

/** Resposta binária (download de documento) com cabeçalhos que impedem execução no navegador. */
class FileResponse {
  constructor(
    readonly data: Buffer,
    readonly mime: string,
    readonly fileName: string,
  ) {}
}

/** Resposta com redirecionamento e cookies (login Microsoft). */
class RedirectResponse {
  constructor(
    readonly location: string,
    readonly cookies: string[] = [],
  ) {}
}

/** Resposta JSON que também grava cookies. */
class CookieResponse {
  constructor(
    readonly body: unknown,
    readonly cookies: string[],
  ) {}
}

/** ?module=pj|pf (padrão pj, para as telas que já existiam). */
function moduleParam(c: { url: URL; req: Request }): Module {
  const m = c.url.searchParams.get('module') ?? c.req.headers.get('x-module') ?? 'pj'
  if (!isModule(m)) throw new AppError('INVALID_MODULE', 'Módulo inválido.', 400)
  return m
}

function toUserDTO(a: UseCaseDeps['ctx']['actor']): UserDTO {
  return { id: a.id, fullName: a.fullName, email: a.email, roles: a.roles, roleNames: a.roleNames, permissions: a.permissions, modules: a.memberOf, access: a.access, globalDev: a.globalDev }
}

// ----------------------------------------------------------------------------- rotas públicas

pub('GET', '/health', async () => ({ ok: true, time: new Date().toISOString(), env: envPresence() }))
pub('GET', '/auth/config', async (): Promise<AuthConfigDTO> => ({ mode: authMode(), entraConfigured: entraConfigured() }))

pub('GET', '/auth/dev-users', async () => {
  if (!devLoginAllowed()) throw new AppError('NOT_FOUND', 'Rota inexistente.', 404)
  const db = getDb()
  const [rows, catalog] = await Promise.all([
    db.select({ id: schema.users.id, fullName: schema.users.fullName, roles: schema.users.roles, active: schema.users.active }).from(schema.users).orderBy(schema.users.fullName),
    loadRoleCatalog(db),
  ])
  const names = new Map(catalog.map((r) => [r.key, r.name]))
  return rows.filter((u) => u.active).map(({ id, fullName, roles }) => ({ id, fullName, roleNames: roles.map((r) => names.get(r) ?? r) }))
})

pub('POST', '/auth/dev-login', async (c) => {
  if (!devLoginAllowed()) throw new AppError('NOT_FOUND', 'Rota inexistente.', 404)
  const { userId } = parse(z.object({ userId: uuid }), await c.json())
  const actor = await loadActor(getDb(), userId)
  if (!actor) throw new AppError('NO_ACCESS', 'Usuário inativo ou inexistente.', 403)
  const s = issueStaffSession(actor.id)
  return new CookieResponse({ user: toUserDTO(actor) }, [setCookie(STAFF_COOKIE, s.value, s.maxAge)])
})

pub('POST', '/auth/logout', async () => new CookieResponse({ ok: true }, [clearCookie(STAFF_COOKIE)]))

pub('GET', '/auth/microsoft/start', async () => {
  const { url, state } = entraAuthorizeUrl()
  return new RedirectResponse(url, [setCookie('forn_oidc', state, 600)])
})

pub('GET', '/auth/microsoft/callback', async (c) => {
  const code = c.url.searchParams.get('code')
  const state = c.url.searchParams.get('state')
  const clear = clearCookie('forn_oidc')
  if (!code || !state) return new RedirectResponse('/entrar?erro=cancelado', [clear])
  try {
    const userId = await entraCallback(getDb(), code, state, readCookie(c.req.headers.get('cookie'), 'forn_oidc'))
    const s = issueStaffSession(userId)
    return new RedirectResponse('/', [clear, setCookie(STAFF_COOKIE, s.value, s.maxAge)])
  } catch (err) {
    const e = toAppError(err)
    return new RedirectResponse(`/entrar?erro=${encodeURIComponent(e.message)}`, [clear])
  }
})

// Portal do fornecedor: abertura do link e código (sem sessão)
const portalDeps = (): PortalDeps => {
  const db = getDb()
  return {
    db,
    now: () => new Date(),
    get uau() {
      return getUauGateway()
    },
    mailer: createMailer(db),
    get storage() {
      return getStorage()
    },
    company: new PublicCompanyLookup(),
    sanctions: new TransparenciaSanctions(),
  }
}
const portalSessionId = (c: Ctx) => verifySession(readCookie(c.req.headers.get('cookie'), PORTAL_COOKIE), 'supplier')?.sub ?? null

pub('GET', '/portal/link/:token', async (c) => portal.portalState(portalDeps(), c.params.token!, portalSessionId(c)))
pub('POST', '/portal/link/:token/code', async (c) => portal.sendCode(portalDeps(), c.params.token!))
pub('POST', '/portal/link/:token/verify', async (c) => {
  const { code } = parse(portalCodeSchema, await c.json())
  const session = await portal.verifyCode(portalDeps(), c.params.token!, code)
  return new CookieResponse({ ok: true }, [setCookie(PORTAL_COOKIE, session.cookie, session.maxAge)])
})
pub('GET', '/portal/cep/:cep', async (c) => {
  const cep = (c.params.cep ?? '').replace(/\D/g, '')
  if (cep.length !== 8) throw new AppError('INVALID_CEP', 'CEP com 8 dígitos.', 422)
  return (await findCep(cep)) ?? { cep, street: null, district: null, city: null, uf: null }
})

// Portal com sessão (cookie preso ao convite)
portalRoute('GET', '/portal/me', (deps, inviteId) => portal.portalData(deps, inviteId))
portalRoute('PUT', '/portal/me/profile', async (deps, inviteId, c) => portal.saveProfile(deps, inviteId, parse(portalProfileSchema, await c.json()).profile))
portalRoute('POST', '/portal/me/documents', async (deps, inviteId, c) => portal.portalUpload(deps, inviteId, await uploadForm(c)))
portalRoute('POST', '/portal/me/submit', (deps, inviteId) => portal.portalSubmit(deps, inviteId))
portalRoute('GET', '/portal/me/documents/:id/file', async (deps, inviteId, c) => {
  const { doc, data } = await portal.portalDownload(deps, inviteId, id(c))
  return new FileResponse(data, doc.mime, doc.fileName)
})

// ----------------------------------------------------------------------------- equipe

staff('GET', '/me', async (deps) => ({ user: toUserDTO(deps.ctx.actor) }))
staff('GET', '/dashboard', async (deps, c) => getDashboard(deps, moduleParam(c)))
staff('GET', '/lookup/:document', async (deps, c) => suppliersUC.lookupDocument(deps, parse(documentNumberSchema, c.params.document)), undefined, byLookup)

// solicitações
staff('GET', '/requests', async (deps, c) => requests.listRequests(deps, c.url.searchParams.get('scope') === 'mine' ? 'mine' : 'all', moduleParam(c)))
staff('POST', '/requests', async (deps, c) => requests.createRequest(deps, parse(createRequestSchema, await c.json())), 201, byBodyModule)
staff('GET', '/requests/:id', async (deps, c) => requests.getRequest(deps, id(c)), undefined, byRequest)
staff('POST', '/requests/:id/invite', async (deps, c) => requests.inviteSupplier(deps, id(c), parse(inviteSchema, await c.json())), undefined, byRequest)
staff('POST', '/requests/:id/cancel', async (deps, c) => requests.cancelRequest(deps, id(c), parse(optionalCommentSchema, await c.json()).comment ?? null), undefined, byRequest)
staff('POST', '/requests/:id/reject', async (deps, c) => requests.rejectRequest(deps, id(c), parse(commentSchema, await c.json()).comment), undefined, byRequest)
staff('POST', '/requests/:id/request-changes', async (deps, c) => requests.requestChanges(deps, id(c), parse(commentSchema, await c.json()).comment), undefined, byRequest)
staff('POST', '/requests/:id/send-to-approval', async (deps, c) => requests.sendToApproval(deps, id(c)), undefined, byRequest)
staff('POST', '/requests/:id/return', async (deps, c) => requests.returnToAnalysis(deps, id(c), parse(commentSchema, await c.json()).comment), undefined, byRequest)
staff('GET', '/requests/:id/uau-preview', async (deps, c) => approval.uauPreview(deps, id(c)), undefined, byRequest)
staff('POST', '/requests/:id/approve', async (deps, c) => approval.approveRequest(deps, id(c)), undefined, byRequest)
staff('POST', '/requests/:id/uau-attachments', async (deps, c) => approval.resendAttachments(deps, id(c)), undefined, byRequest)
staff('POST', '/suppliers/:id/uau-attachments', async (deps, c) => approval.resendSupplierAttachments(deps, id(c)), undefined, bySupplier)
staff('PUT', '/requests/:id/qualification', async (deps, c) => {
  await qualification.saveQualification(deps, id(c), parse(qualificationAnswersSchema, await c.json()))
  return requests.getRequest(deps, id(c))
}, undefined, byRequest)
staff('GET', '/works', (deps) => works.listWorks(deps), undefined, 'pj')
staff('POST', '/works', async (deps, c) => works.saveWork(deps, null, parse(workSchema, await c.json())), 201, 'pj')
staff('PUT', '/works/:id', async (deps, c) => works.saveWork(deps, id(c), parse(workSchema, await c.json())), undefined, 'pj')
staff('GET', '/qualification-questions', (deps) => qualification.listQualificationQuestions(deps), undefined, 'pj')
staff('POST', '/qualification-questions', async (deps, c) => qualification.saveQualificationQuestion(deps, null, parse(qualificationQuestionSchema, await c.json())), 201, 'pj')
staff('PUT', '/qualification-questions/:id', async (deps, c) => qualification.saveQualificationQuestion(deps, id(c), parse(qualificationQuestionSchema, await c.json())), undefined, 'pj')
staff('POST', '/requests/:id/documents', async (deps, c) => requests.staffUpload(deps, id(c), await uploadForm(c)), undefined, byRequest)
staff('POST', '/requests/:id/documents/:docId/review', async (deps, c) =>
  requests.reviewDocument(deps, id(c), id(c, 'docId'), parse(reviewDocumentSchema, await c.json())), undefined, byRequest)
staff('POST', '/requests/:id/risk', async (deps, c) => {
  const r = await requests.getRequest(deps, id(c))
  await suppliersUC.runRiskCheck(deps, r.supplier.id, r.id)
  return requests.getRequest(deps, r.id)
}, undefined, byRequest)

// documentos
staff('GET', '/documents/:id/file', async (deps, c) => {
  requirePermission(deps.ctx.actor, PERMISSIONS.supplierRead, PERMISSIONS.requestAnalyze)
  const { doc, data } = await readDocumentFile(deps.db, deps.storage, id(c))
  await suppliersUC.requireSupplierModule(deps, doc.supplierId)
  return new FileResponse(data, doc.mime, doc.fileName)
}, undefined, byDocument)

// fornecedores e avaliações
staff('GET', '/suppliers', async (deps, c) => suppliersUC.listSuppliers(deps, moduleParam(c)))
staff('POST', '/suppliers/uau-sync', async (deps, c) => suppliersUC.syncFromUau(deps, parse(uauSyncSchema, await c.json())))
staff('POST', '/suppliers/import', async (deps, c) => suppliersUC.importFromUau(deps, parse(importFromUauSchema, await c.json()).documents), undefined, 'pj')
staff('GET', '/suppliers/:id', async (deps, c) => suppliersUC.getSupplier(deps, id(c)), undefined, bySupplier)
staff('PATCH', '/suppliers/:id', async (deps, c) => suppliersUC.updateSupplier(deps, id(c), parse(supplierUpdateSchema, await c.json())), undefined, bySupplier)
staff('POST', '/suppliers/:id/risk', async (deps, c) => {
  await suppliersUC.runRiskCheck(deps, id(c), null)
  return suppliersUC.getSupplier(deps, id(c))
}, undefined, bySupplier)
staff('POST', '/evaluations', async (deps, c) => suppliersUC.createEvaluation(deps, parse(evaluationSchema, await c.json())), 201, 'pj')
staff('GET', '/evaluations/mine', (deps) => suppliersUC.myEvaluations(deps), undefined, 'pj')
staff('GET', '/evaluate/suppliers', async (deps, c) => suppliersUC.searchEvaluableSuppliers(deps, c.url.searchParams.get('q') ?? ''), undefined, 'pj')

// configurações (perfil dev)
staff('GET', '/models', async (deps, c) => settings.listModels(deps, { onlyActive: c.url.searchParams.get('active') === '1', module: c.url.searchParams.get('module') ? moduleParam(c) : undefined }))
staff('POST', '/models', async (deps, c) => settings.saveModel(deps, null, parse(modelSchema, await c.json())), 201)
staff('PUT', '/models/:id', async (deps, c) => settings.saveModel(deps, id(c), parse(modelSchema, await c.json())))
staff('DELETE', '/models/:id', async (deps, c) => settings.deleteModel(deps, id(c)))
staff('GET', '/document-types', (deps) => settings.listDocumentTypes(deps))
staff('POST', '/document-types', async (deps, c) => settings.saveDocumentType(deps, null, parse(documentTypeSchema, await c.json())), 201)
staff('PUT', '/document-types/:id', async (deps, c) => settings.saveDocumentType(deps, id(c), parse(documentTypeSchema, await c.json())))
staff('GET', '/criteria', (deps) => settings.listCriteria(deps), undefined, 'pj')
staff('POST', '/criteria', async (deps, c) => settings.saveCriterion(deps, null, parse(criterionSchema, await c.json())), 201, 'pj')
staff('PUT', '/criteria/:id', async (deps, c) => settings.saveCriterion(deps, id(c), parse(criterionSchema, await c.json())), undefined, 'pj')
staff('GET', '/risk-rules', (deps) => settings.listRiskRules(deps), undefined, 'pj')
staff('PUT', '/risk-rules', async (deps, c) => settings.updateRiskRules(deps, parse(riskRuleUpdateSchema, await c.json())), undefined, 'pj')
staff('GET', '/users', (deps) => settings.listUsers(deps))
staff('POST', '/users', async (deps, c) => settings.saveUser(deps, null, parse(teamUserSchema, await c.json())), 201)
staff('PUT', '/users/:id', async (deps, c) => settings.saveUser(deps, id(c), parse(teamUserSchema, await c.json())))
const roleKey = (c: Ctx) => parse(z.string().regex(/^[a-z0-9-]{1,40}$/), c.params.key)
staff('GET', '/roles', (deps) => settings.listRoles(deps))
staff('POST', '/roles', async (deps, c) => settings.saveRole(deps, null, parse(roleSchema, await c.json())), 201)
staff('PUT', '/roles/:key', async (deps, c) => settings.saveRole(deps, roleKey(c), parse(roleSchema, await c.json())))
staff('DELETE', '/roles/:key', async (deps, c) => settings.deleteRole(deps, roleKey(c)))

// painel dev
staff('GET', '/dev/diagnostics', (deps) => dev.diagnostics(deps))
staff('GET', '/dev/outbox', (deps) => dev.listOutbox(deps))

// ----------------------------------------------------------------------------- dispatcher

const SECURITY_HEADERS = { 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }

function json(data: unknown, status: number, correlationId: string, cookies: string[] = []) {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'x-correlation-id': correlationId, ...SECURITY_HEADERS })
  for (const c of cookies) headers.append('set-cookie', c)
  return new Response(JSON.stringify(data), { status, headers })
}

function errorResponse(err: AppError, correlationId: string) {
  const body: ApiErrorBody = { error: { code: err.code, message: err.message, details: err.details, correlationId } }
  return json(body, err.status, correlationId)
}

function toResponse(result: unknown, status: number, correlationId: string): Response {
  if (result instanceof FileResponse) {
    return new Response(new Uint8Array(result.data), {
      status: 200,
      headers: {
        'content-type': result.mime,
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
        'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        ...SECURITY_HEADERS,
      },
    })
  }
  if (result instanceof RedirectResponse) {
    const headers = new Headers({ location: result.location, ...SECURITY_HEADERS })
    for (const c of result.cookies) headers.append('set-cookie', c)
    return new Response(null, { status: 302, headers })
  }
  if (result instanceof CookieResponse) return json(result.body, status, correlationId, result.cookies)
  return json(result ?? { ok: true }, status, correlationId)
}

function resolvePath(url: URL): string {
  // Na Vercel o rewrite envia /api/router?__path=<resto>; localmente a URL chega como /api/<resto>
  const fromRewrite = url.searchParams.get('__path')
  if (fromRewrite !== null) return '/' + fromRewrite.replace(/^\/+/, '')
  return url.pathname.replace(/^\/api/, '') || '/'
}

function staffDeps(ctx: RequestContext): UseCaseDeps {
  const db = getDb()
  return {
    db,
    ctx,
    get uau() {
      return getUauGateway()
    },
    mailer: createMailer(db),
    get storage() {
      return getStorage()
    },
    company: new PublicCompanyLookup(),
    sanctions: new TransparenciaSanctions(),
  }
}

export async function handle(req: Request): Promise<Response> {
  const correlationId = req.headers.get('x-correlation-id')?.slice(0, 64) || globalThis.crypto.randomUUID()
  const url = new URL(req.url)
  const path = resolvePath(url)

  try {
    const candidates = routes.filter((r) => r.pattern.test(path))
    const route = candidates.find((r) => r.method === req.method)
    if (!route) {
      throw new AppError(candidates.length ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND', candidates.length ? 'Método não permitido.' : 'Rota inexistente.', candidates.length ? 405 : 404)
    }
    // CSRF: navegador não envia cabeçalho customizado entre sites sem CORS (que não liberamos)
    if (req.method !== 'GET' && req.headers.get('x-requested-with') !== 'fornecedores') {
      throw new AppError('CSRF', 'Requisição recusada.', 403)
    }

    const m = route.pattern.exec(path)!
    const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]))
    let jsonCache: Promise<unknown> | null = null
    const c: Ctx = {
      req,
      url,
      params,
      json: () =>
        (jsonCache ??= req.text().then((t) => {
          if (!t) return {}
          try {
            return JSON.parse(t) as unknown
          } catch {
            throw new AppError('INVALID_JSON', 'Corpo da requisição inválido.', 400)
          }
        })),
      form: () => req.formData().catch(() => Promise.reject(new AppError('INVALID_FORM', 'Envio de arquivo inválido.', 400))),
    }

    let result: unknown
    if (route.kind === 'public') {
      result = await (route.handler as PublicHandler)(c)
    } else if (route.kind === 'portal') {
      const inviteId = portalSessionId(c)
      if (!inviteId) throw new AppError('PORTAL_SESSION', 'Sua sessão expirou. Abra o link do e-mail de novo.', 401)
      result = await (route.handler as PortalHandler)(portalDeps(), inviteId, c)
    } else {
      const session = verifySession(readCookie(req.headers.get('cookie'), STAFF_COOKIE), 'user')
      if (!session) throw new AppError('UNAUTHENTICATED', 'Sessão expirada. Entre novamente.', 401)
      // Módulos independentes: as permissões valem só no módulo desta requisição
      const module = route.module === undefined ? moduleParam(c) : typeof route.module === 'string' ? route.module : await route.module(c)
      const actor = await loadActor(getDb(), session.sub, module)
      if (!actor) throw new AppError('NO_ACCESS', 'Seu acesso foi removido ou desativado.', 403)
      result = await (route.handler as StaffHandler)(staffDeps({ correlationId, actor, now: () => new Date(), module }), c)
    }
    return toResponse(result, route.status, correlationId)
  } catch (err) {
    if (err instanceof ZodError) return errorResponse(new AppError('VALIDATION', 'Dados inválidos.', 422, err.flatten()), correlationId)
    const appErr = toAppError(err)
    if (appErr.status >= 500) console.error(`[${correlationId}]`, err)
    return errorResponse(appErr, correlationId)
  }
}
