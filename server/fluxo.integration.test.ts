/**
 * Teste de integração do fluxo de cadastro com banco Postgres EM MEMÓRIA (PGlite).
 * Aplica as mesmas migrações da produção e chama as funções reais do app; UAU, e-mail,
 * Receita, sanções e arquivos são simulados. Nunca toca no Neon nem no UAU.
 *
 * Cobre: pré-cadastro da Obra sem modelo → triagem de Suprimentos (modelo) → resposta do
 * fornecedor → aprovação (corpo enviado ao UAU), avisos por e-mail, permissões e vencimentos.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { defaultRuleConfigs } from '../shared/domain/risk'
import * as approval from './application/use-cases/approval'
import * as dashboard from './application/use-cases/dashboard'
import * as portal from './application/use-cases/portal'
import * as qualificationUC from './application/use-cases/qualification'
import * as requests from './application/use-cases/requests'
import * as suppliersUC from './application/use-cases/suppliers'
import * as worksUC from './application/use-cases/works'
import * as settingsUC from './application/use-cases/settings'
import { loadActor } from './infrastructure/auth'
import * as schema from './infrastructure/db/schema'

/* eslint-disable @typescript-eslint/no-explicit-any -- dublês de teste */

const CNPJ = '11222333000181'
const CNPJ2 = '11444777000161'
const CNPJ3 = '19131243000197'
const DAY = 86_400_000
const isoIn = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10)
const pdf = (name: string) => new File([Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')], name, { type: 'application/pdf' })

const mails: { to: string[]; subject: string; html: string }[] = []
const uauCalls: { route: string; body: any }[] = []
const files = new Map<string, Buffer>()
/** Simula o UAU recusando os anexos (como na primeira gravação real, sem empresa). */
let failAttach = false

const mailer = {
  provider: 'graph' as const,
  async send(m: { to: string[]; subject: string; html?: string }) {
    mails.push({ to: m.to, subject: m.subject, html: m.html ?? '' })
  },
}
const storage = {
  kind: 'local' as const,
  async put(key: string, data: Buffer) {
    files.set(key, data)
    return { key, size: data.length }
  },
  async get(key: string) {
    return files.get(key)!
  },
}
/** UAU com gravação "ligada", mas sem rede: guarda cada chamada para conferir o corpo. */
let uauPeople: Record<string, any>[] = []
const uau = {
  writeEnabled: true,
  async checkLogin() {
    return 0
  },
  async call(route: string, body: unknown) {
    uauCalls.push({ route, body })
    if (route.endsWith('ConsultarDadosPessoaPorCpfCnpjEStatus'))
      return { route, status: 400, ok: false, ms: 1, data: [{ Descricao: 'Não foi encontrado nenhuma pessoa com os dados informados.' }] }
    if (route.endsWith('GravarPessoa')) return { route, status: 200, ok: true, ms: 1, data: [{ cod_pes: 9999 }] }
    if (route.endsWith('ConsultarPessoasPorCondicao')) {
      // faixa "cod_pes > N and cod_pes <= M" sobre a base falsa do UAU
      const [, a, b] = /cod_pes > (\d+) and cod_pes <= (\d+)/.exec((body as any).condicaoConsultarPessoa) ?? []
      return { route, status: 200, ok: true, ms: 1, data: uauPeople.filter((p) => p.CodigoPessoa > Number(a) && p.CodigoPessoa <= Number(b)) }
    }
    if (route.endsWith('ListarDiretorios')) return { route, status: 200, ok: true, ms: 1, data: [] }
    if (route.endsWith('AnexarArquivosBase64Request') && failAttach) return { route, status: 400, ok: false, ms: 1, data: { Descricao: 'Não foi possível gravar o arquivo.' } }
    return { route, status: 200, ok: true, ms: 1, data: '' }
  },
}
const company = {
  async find(cnpj: string) {
    if (cnpj !== CNPJ) return null
    return {
      cnpj,
      razaoSocial: 'EMPRESA TESTE LTDA',
      nomeFantasia: 'TESTE',
      situacaoCadastral: 'ATIVA',
      dataSituacao: null,
      dataAbertura: '2010-05-03',
      naturezaJuridica: null,
      porte: null,
      capitalSocial: 100_000,
      cnaePrincipal: null,
      cnaesSecundarios: [],
      simples: false,
      mei: false,
      email: null,
      telefone: null,
      endereco: { cep: null, logradouro: null, numero: null, complemento: null, bairro: null, municipio: null, uf: null },
      socios: [],
      fonte: 'teste',
    }
  },
}
const sanctions = {
  configured: true,
  async ceis() {
    return { count: 0, items: [] }
  },
  async cnep() {
    return { count: 0, items: [] }
  },
}

let db: any
let users: Record<'obra' | 'analista' | 'aprovador', { id: string }>
let model: { id: string }
let tCnpj: { id: string }
let tCnd: { id: string }
let requestId = ''

/** Igual ao router: o usuário entra recortado para o módulo da requisição (os módulos são independentes). */
const staff = async (u: { id: string }, module: 'pj' | 'pf' = 'pj') =>
  ({ db, uau, mailer, storage, company, sanctions, ctx: { correlationId: 'teste', actor: await loadActor(db, u.id, module), now: () => new Date(), module } }) as any
const supplierPortal = () => ({ db, uau, mailer, storage, company, sanctions, now: () => new Date() }) as any
/** Responde todas as perguntas ativas (Sim; "Não se aplica" onde existir, para variar). */
async function answerAll(deps: any, id: string) {
  const d = await requests.getRequest(deps, id)
  await qualificationUC.saveQualification(deps, id, { answers: d.qualification.items.map((i: any) => ({ questionId: i.questionId, answer: i.allowNa ? 'na' : 'sim' })) })
}
const sentTo = (email: string, subject: RegExp) => mails.some((m) => m.to.includes(email) && subject.test(m.subject))

beforeAll(async () => {
  process.env.UAU_PASTA_ANEXOS = 'BASE\\FORN'
  const pg = new PGlite()
  for (const file of readdirSync('db/migrations').filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of readFileSync(`db/migrations/${file}`, 'utf8').split('--> statement-breakpoint')) if (stmt.trim()) await pg.exec(stmt)
  }
  db = drizzle(pg, { schema })

  const [obra, analista, aprovador] = await db
    .insert(schema.users)
    .values([
      { email: 'obra@t.com', fullName: 'Obra Teste', roles: ['obra'] },
      { email: 'analista@t.com', fullName: 'Analista Teste', roles: ['analista'] },
      { email: 'aprovador@t.com', fullName: 'Aprovador Teste', roles: ['aprovador'] },
    ])
    .returning()
  users = { obra, analista, aprovador }
  ;[tCnpj, tCnd] = await db
    .insert(schema.documentTypes)
    .values([
      { name: 'Cartão CNPJ', description: 'x', hasExpiry: false },
      { name: 'CND Federal', description: 'x', hasExpiry: true },
    ])
    .returning()
  ;[model] = await db.insert(schema.supplierModels).values({ name: 'Materiais', description: 'x', personKind: 'PJ', allowedCnae: [] }).returning()
  await db.insert(schema.modelRequirements).values([
    { modelId: model.id, documentTypeId: tCnpj.id, required: true },
    { modelId: model.id, documentTypeId: tCnd.id, required: true },
  ])
  await db.insert(schema.riskRuleConfigs).values(defaultRuleConfigs()).onConflictDoNothing()
}, 60_000)

describe('fluxo de cadastro (banco em memória)', () => {
  it('Obra faz o pré-cadastro sem modelo e Suprimentos é avisado', async () => {
    const asObra = await staff(users.obra)
    expect(asObra.ctx.actor.permissions).toEqual(['request.create', 'request.read.own', 'evaluation.create'])
    mails.length = 0
    const r = await requests.createRequest(asObra, { document: CNPJ, modelId: null, contactEmail: 'forn@t.com', urgency: 'normal', sendInvite: false } as any)
    requestId = r.id
    const d = await requests.getRequest(asObra, r.id)
    expect(d.model).toBeNull()
    expect(d.status).toBe('solicitado')
    expect(mails).toHaveLength(1)
    expect(mails[0]!.to).toEqual(expect.arrayContaining(['analista@t.com', 'aprovador@t.com']))
    expect(mails[0]!.to).not.toContain('obra@t.com')
    const list = await requests.listRequests(asObra, 'all')
    expect(list.map((x) => [x.id, x.modelName])).toEqual([[r.id, null]])
  })

  it('Obra só acompanha: sem painel, sem base de fornecedores e sem envio do formulário', async () => {
    const asObra = await staff(users.obra)
    await expect(dashboard.getDashboard(asObra)).rejects.toMatchObject({ status: 403 })
    await expect(suppliersUC.listSuppliers(asObra)).rejects.toMatchObject({ status: 403 })
    await expect(requests.inviteSupplier(asObra, requestId, { modelId: model.id })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // a tentativa recusada não pode deixar o modelo gravado
    expect((await requests.getRequest(asObra, requestId)).model).toBeNull()
  })

  it('Suprimentos escolhe o modelo ao enviar o formulário', async () => {
    const asAnalyst = await staff(users.analista)
    await expect(requests.inviteSupplier(asAnalyst, requestId, {})).rejects.toMatchObject({ code: 'MODEL_REQUIRED' })
    mails.length = 0
    const d = await requests.inviteSupplier(asAnalyst, requestId, { modelId: model.id })
    expect(d.model?.id).toBe(model.id)
    expect(d.status).toBe('aguardando_fornecedor')
    expect(mails.some((m) => m.to.includes('forn@t.com'))).toBe(true)
    expect(mails.some((m) => m.to.includes('obra@t.com'))).toBe(false)
  })

  it('fornecedor responde e a Obra é avisada', async () => {
    const [invite] = (await db.select().from(schema.invites).where(eq(schema.invites.requestId, requestId))).filter((i: any) => !i.revokedAt)
    await portal.saveProfile(supplierPortal(), invite.id, {
      document: CNPJ,
      legalName: 'EMPRESA TESTE LTDA',
      tradeName: 'TESTE',
      email: 'forn@t.com',
      phoneDdd: '62',
      phoneNumber: '32000000',
      website: null,
      contactName: 'Contato',
      stateRegistration: null,
      municipalRegistration: null,
      mainCnae: null,
      simplesNacional: false,
      address: { cep: '74003010', street: 'Praça Cívica', number: 'S/N', complement: null, district: 'Centro', city: 'Goiânia', uf: 'GO' },
      bank: { bankCode: 1, bankName: 'BB', agency: '0001', account: '123-4', accountType: 0 },
      pix: null,
    })
    await portal.portalUpload(supplierPortal(), invite.id, { file: pdf('Cartão CNPJ.pdf'), documentTypeId: tCnpj.id, issuedAt: null, expiresAt: null })
    await portal.portalUpload(supplierPortal(), invite.id, { file: pdf('Certidão Federal.pdf'), documentTypeId: tCnd.id, issuedAt: null, expiresAt: isoIn(365) })
    mails.length = 0
    await portal.portalSubmit(supplierPortal(), invite.id)
    expect(sentTo('obra@t.com', /respondeu/i)).toBe(true)
    const names = (await db.select({ n: schema.documents.fileName }).from(schema.documents)).map((x: any) => x.n)
    expect(names).toEqual(expect.arrayContaining(['Cartao CNPJ.pdf', 'Certidao Federal.pdf']))
  })

  it('aprovação grava no UAU com Fundação, cobrança, número em branco e anexos certos', async () => {
    const asAnalyst = await staff(users.analista)
    const d = await requests.getRequest(asAnalyst, requestId)
    for (const doc of d.documents) {
      await requests.reviewDocument(asAnalyst, requestId, doc.id, { status: 'aprovado', note: null, issuedAt: null, expiresAt: doc.documentTypeId === tCnd.id ? isoIn(365) : null })
    }
    await suppliersUC.runRiskCheck(asAnalyst, d.supplier.id, requestId)

    // formulário de qualificação: 8 perguntas da migração, todas obrigatórias
    expect(d.qualification.total).toBe(8)
    await expect(requests.sendToApproval(asAnalyst, requestId)).rejects.toMatchObject({ details: { blockers: expect.arrayContaining([expect.stringContaining('qualificação (8 pergunta')]) } })
    const noNa = d.qualification.items.find((i: any) => !i.allowNa)!
    await expect(qualificationUC.saveQualification(asAnalyst, requestId, { answers: [{ questionId: noNa.questionId, answer: 'na' }] })).rejects.toMatchObject({ code: 'INVALID_ANSWER' })
    await expect(qualificationUC.saveQualification(await staff(users.obra), requestId, { answers: [{ questionId: noNa.questionId, answer: 'sim' }] })).rejects.toMatchObject({ status: 403 })
    await qualificationUC.saveQualification(asAnalyst, requestId, { answers: [{ questionId: noNa.questionId, answer: 'nao' }] })
    const partial = await requests.getRequest(asAnalyst, requestId)
    expect([partial.qualification.answered, partial.qualification.complete]).toEqual([1, false])
    await answerAll(asAnalyst, requestId)
    const full = await requests.getRequest(asAnalyst, requestId)
    expect([full.qualification.answered, full.qualification.complete]).toEqual([8, true])
    expect(full.events.some((e) => e.kind === 'qualification')).toBe(true)

    await requests.sendToApproval(asAnalyst, requestId)
    // na aprovação o formulário fica travado
    await expect(qualificationUC.saveQualification(asAnalyst, requestId, { answers: [{ questionId: noNa.questionId, answer: 'sim' }] })).rejects.toMatchObject({ code: 'QUALIFICATION_LOCKED' })
    uauCalls.length = 0
    mails.length = 0
    await approval.approveRequest(await staff(users.aprovador), requestId)

    const save = uauCalls.find((c) => c.route.endsWith('GravarPessoa'))?.body
    expect(save.info_pes.dtnasc_pes).toBe('2010-05-03T00:00:00')
    expect(save.info_pesendereco_principal).toMatchObject({ Tipo_pend: 0, NumEnd_pend: '' })
    expect(save.infopesendereco_cobranca).toMatchObject({ Tipo_pend: 1, NumEnd_pend: '', Endereco_pend: 'Praça Cívica', CEP_pend: '74003010' })
    const attach = uauCalls.find((c) => c.route.endsWith('AnexarArquivosBase64Request'))?.body
    expect(attach.empresa).toBe(1)
    expect(attach.lista_arquivos.map((f: any) => f.NomeArquivo)).toEqual(expect.arrayContaining(['Cartao CNPJ', 'Certidao Federal', 'Formulario de qualificacao - solicitacao 1']))
    const form = attach.lista_arquivos.find((f: any) => f.NomeArquivo.startsWith('Formulario'))
    expect(Buffer.from(form.ConteudoArquivo, 'base64').subarray(0, 5).toString()).toBe('%PDF-')
    expect((await requests.getRequest(asAnalyst, requestId)).qualification.uauAttachedAt).not.toBeNull()

    const done = await requests.getRequest(asAnalyst, requestId)
    expect(done.status).toBe('gravado_uau')
    expect((done.uauResult as any)?.codPes).toBe(9999)
    expect(sentTo('obra@t.com', /homologado/i)).toBe(true)
  })

  it('cancelamento avisa a Obra e tira os documentos dos vencimentos', async () => {
    const asObra = await staff(users.obra)
    const asAnalyst = await staff(users.analista)
    const r = await requests.createRequest(asObra, { document: CNPJ2, modelId: null, contactEmail: 'b@t.com', urgency: 'normal', sendInvite: false } as any)
    await requests.inviteSupplier(asAnalyst, r.id, { modelId: model.id })
    await requests.staffUpload(asAnalyst, r.id, { file: pdf('cnd.pdf'), documentTypeId: tCnd.id, issuedAt: null, expiresAt: isoIn(10) })
    expect((await dashboard.getDashboard(asAnalyst)).documents.expiring).toBe(1)

    mails.length = 0
    await requests.cancelRequest(asAnalyst, r.id, 'não precisa mais')
    expect(sentTo('obra@t.com', /cancelada/i)).toBe(true)
    const after = await dashboard.getDashboard(asAnalyst)
    expect(after.documents.expiring).toBe(0)
    expect(after.expiringList).toHaveLength(0)
    const supplier = (await suppliersUC.listSuppliers(asAnalyst)).find((s) => s.document === CNPJ2)
    expect(supplier?.docsExpiring).toBe(0)
  })

  it('Obra cancelando a própria solicitação não recebe aviso de si mesma', async () => {
    const asObra = await staff(users.obra)
    const r = await requests.createRequest(asObra, { document: CNPJ3, modelId: null, contactEmail: 'd@t.com', urgency: 'normal', sendInvite: false } as any)
    mails.length = 0
    await requests.cancelRequest(asObra, r.id, null)
    expect(mails.some((m) => m.to.includes('obra@t.com'))).toBe(false)
  })

  it('anexo recusado na aprovação é reenviado pelo botão', async () => {
    const asObra = await staff(users.obra)
    const asAnalyst = await staff(users.analista)
    const asApprover = await staff(users.aprovador)
    const CNPJ4 = '04252011000110'
    const r = await requests.createRequest(asObra, { document: CNPJ4, modelId: null, contactEmail: 'e@t.com', urgency: 'normal', sendInvite: false } as any)
    await requests.inviteSupplier(asAnalyst, r.id, { modelId: model.id })
    const [invite] = (await db.select().from(schema.invites).where(eq(schema.invites.requestId, r.id))).filter((i: any) => !i.revokedAt)
    await portal.saveProfile(supplierPortal(), invite.id, {
      document: CNPJ4, legalName: 'OUTRA EMPRESA LTDA', tradeName: null, email: 'e@t.com', phoneDdd: '62', phoneNumber: '32000001',
      website: null, contactName: null, stateRegistration: null, municipalRegistration: null, mainCnae: null, simplesNacional: null,
      address: { cep: '74003010', street: 'Rua 1', number: '10', complement: null, district: 'Centro', city: 'Goiânia', uf: 'GO' },
      bank: null, pix: null,
    })
    await portal.portalUpload(supplierPortal(), invite.id, { file: pdf('cnpj.pdf'), documentTypeId: tCnpj.id, issuedAt: null, expiresAt: null })
    await portal.portalUpload(supplierPortal(), invite.id, { file: pdf('cnd.pdf'), documentTypeId: tCnd.id, issuedAt: null, expiresAt: isoIn(365) })
    await portal.portalSubmit(supplierPortal(), invite.id)
    const d = await requests.getRequest(asAnalyst, r.id)
    for (const doc of d.documents) {
      await requests.reviewDocument(asAnalyst, r.id, doc.id, { status: 'aprovado', note: null, issuedAt: null, expiresAt: doc.documentTypeId === tCnd.id ? isoIn(365) : null })
    }
    await suppliersUC.runRiskCheck(asAnalyst, d.supplier.id, r.id)
    await answerAll(asAnalyst, r.id)
    await requests.sendToApproval(asAnalyst, r.id)

    // aprovação: pessoa criada, mas o UAU recusa os anexos → gravado com aviso
    failAttach = true
    await approval.approveRequest(asApprover, r.id)
    const afterApprove = await requests.getRequest(asApprover, r.id)
    expect(afterApprove.status).toBe('gravado_uau')
    expect(afterApprove.documents.filter((x) => !x.uauAttachedAt)).toHaveLength(2)

    // quem não aprova não pode reenviar
    await expect(approval.resendAttachments(asAnalyst, r.id)).rejects.toMatchObject({ status: 403 })
    // UAU ainda recusando: erro claro e nada marcado como anexado
    await expect(approval.resendAttachments(asApprover, r.id)).rejects.toMatchObject({ code: 'UAU_ATTACH_FAILED' })
    expect((await requests.getRequest(asApprover, r.id)).documents.filter((x) => !x.uauAttachedAt)).toHaveLength(2)

    // a ficha do fornecedor mostra o mesmo que falta: 2 documentos + o formulário
    const pending = (await suppliersUC.getSupplier(asApprover, d.supplier.id)).uauPending
    expect([pending.hasUauRequest, pending.documents.length, pending.forms.map((x) => x.requestId)]).toEqual([true, 2, [r.id]])
    await expect(approval.resendSupplierAttachments(asAnalyst, d.supplier.id)).rejects.toMatchObject({ status: 403 })

    // UAU volta a aceitar: o botão da FICHA manda os pendentes, na pessoa certa
    failAttach = false
    uauCalls.length = 0
    const fromSupplier = await approval.resendSupplierAttachments(asApprover, d.supplier.id)
    expect(fromSupplier.uauPending).toEqual({ hasUauRequest: true, documents: [], forms: [] })
    const resent = await requests.getRequest(asApprover, r.id)
    expect(resent.documents.every((x) => !!x.uauAttachedAt)).toBe(true)
    const body = uauCalls.find((c) => c.route.endsWith('AnexarArquivosBase64Request'))?.body
    // 2 documentos + o PDF do formulário de qualificação
    expect(body.lista_arquivos).toHaveLength(3)
    expect(body.lista_arquivos[0].Identificador).toBe('Pessoas 9999')
    expect(resent.qualification.uauAttachedAt).not.toBeNull()
    expect(resent.events.some((e) => e.kind === 'uau_attach')).toBe(true)

    // sem pendentes: nenhum dos dois botões reenvia de novo
    await expect(approval.resendAttachments(asApprover, r.id)).rejects.toMatchObject({ code: 'NOTHING_PENDING' })
    await expect(approval.resendSupplierAttachments(asApprover, d.supplier.id)).rejects.toMatchObject({ code: 'NOTHING_PENDING' })
  })

  it('médias de avaliação: geral e do mês no Painel, na lista e na ficha', async () => {
    const asAnalyst = await staff(users.analista)
    const [crit] = await db.insert(schema.evaluationCriteria).values({ name: 'Prazo', weight: 1 }).returning()
    const all = await suppliersUC.listSuppliers(asAnalyst)
    const [a, b] = [all.find((x) => x.document === CNPJ)!, all.find((x) => x.document === CNPJ2)!]
    const now = new Date()
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 12))
    const ev = (supplierId: string, average: number, createdAt: Date) => ({ supplierId, evaluatorId: users.analista.id, workName: 'Obra', scores: { [crit.id]: average }, average, createdAt })
    await db.insert(schema.evaluations).values([
      ev(a.id, 5, now), // A: geral 4 (5 e 3); mês 5
      ev(a.id, 3, lastMonth),
      ev(b.id, 2, lastMonth), // B: geral 1,5 (2 e 1); sem avaliação no mês
      ev(b.id, 1, lastMonth),
    ])

    const dash = await dashboard.getDashboard(asAnalyst)
    expect(dash.worstRated[0]).toMatchObject({ supplierId: b.id, overall: 1.5, overallCount: 2, month: null, monthCount: 0 })
    expect(dash.topRated[0]).toMatchObject({ supplierId: a.id, overall: 4, overallCount: 2, month: 5, monthCount: 1 })

    const list = await suppliersUC.listSuppliers(asAnalyst)
    expect(list.find((x) => x.id === a.id)).toMatchObject({ average: 4, evaluations: 2, monthAverage: 5, monthEvaluations: 1 })
    expect(list.find((x) => x.id === b.id)).toMatchObject({ average: 1.5, evaluations: 2, monthAverage: null, monthEvaluations: 0 })

    const full = await suppliersUC.getSupplier(asAnalyst, a.id)
    expect([full.average, full.scores.overall, full.scores.month]).toEqual([4, 4, 5])
    expect(full.scores.monthly[1]).toMatchObject({ average: 3, count: 1 })
  })

  it('Obra avalia fornecedor homologado pela tela "Avaliar"', async () => {
    const asObra = await staff(users.obra)
    // busca: só homologados, por nome ou CNPJ; curinga digitado vale como texto
    expect(await suppliersUC.searchEvaluableSuppliers(asObra, 'a')).toEqual([])
    const byName = await suppliersUC.searchEvaluableSuppliers(asObra, 'empresa teste')
    expect(byName.map((x) => x.document)).toEqual([CNPJ])
    expect(Object.keys(byName[0]!).sort()).toEqual(['document', 'id', 'legalName', 'tradeName'])
    expect((await suppliersUC.searchEvaluableSuppliers(asObra, '112223')).map((x) => x.document)).toEqual([CNPJ])
    expect(await suppliersUC.searchEvaluableSuppliers(asObra, '%%')).toEqual([])
    // CNPJ2 teve a solicitação cancelada: não está homologado e não aparece
    expect(await suppliersUC.searchEvaluableSuppliers(asObra, '114447')).toEqual([])

    const homologated = byName[0]!
    const criteria = (await db.select().from(schema.evaluationCriteria)) as { id: string }[]
    const scores = Object.fromEntries(criteria.map((c) => [c.id, 2]))
    const e = await suppliersUC.createEvaluation(asObra, { supplierId: homologated.id, workName: 'ipanema 212', reference: 'PC-1', scores, comment: null })
    expect(e.average).toBe(2)

    const [notHomologated] = await db.select().from(schema.suppliers).where(eq(schema.suppliers.document, CNPJ2))
    await expect(suppliersUC.createEvaluation(asObra, { supplierId: notHomologated.id, workName: 'Obra', scores, comment: null } as any)).rejects.toMatchObject({ code: 'NOT_HOMOLOGATED' })

    const mine = await suppliersUC.myEvaluations(asObra)
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ supplierId: homologated.id, workName: 'Ipanema 212', reference: 'PC-1', average: 2 })
    // a Obra continua sem ver a base nem o Painel
    await expect(suppliersUC.listSuppliers(asObra)).rejects.toMatchObject({ status: 403 })
    await expect(suppliersUC.getSupplier(asObra, homologated.id)).rejects.toMatchObject({ status: 403 })
  })

  it('obras: lista da migração, cadastro no Painel dev e só obra ativa nos campos', async () => {
    const asObra = await staff(users.obra)
    const asAnalyst = await staff(users.analista)
    const asDev = { ...asAnalyst, ctx: { ...asAnalyst.ctx, actor: { ...asAnalyst.ctx.actor, permissions: [...asAnalyst.ctx.actor.permissions, 'settings.manage'] } } }
    const list = await worksUC.listWorks(asObra)
    expect(list).toHaveLength(34)
    expect(list.find((w) => w.name === 'MetroCasa Vista Cupecê')).toMatchObject({ uauCode: '55', client: 'Metrocasa', active: true })

    // só quem edita configurações cadastra; nome repetido (sem diferenciar maiúsculas) é recusado
    await expect(worksUC.saveWork(asObra, null, { name: 'Obra Nova', active: true })).rejects.toMatchObject({ status: 403 })
    await expect(worksUC.saveWork(asDev, null, { name: 'ipanema 212', active: true })).rejects.toMatchObject({ code: 'WORK_EXISTS' })
    const nova = await worksUC.saveWork(asDev, null, { name: 'Obra Nova Teste', uauCode: '99', client: 'Unità', city: 'Goiânia/GO', active: true })

    // solicitação e avaliação só aceitam obra cadastrada e ativa; o nome é gravado como no cadastro
    await expect(requests.createRequest(asObra, { document: '45723174000110', modelId: null, contactEmail: 'w@t.com', workName: 'Obra Inventada', urgency: 'normal', sendInvite: false } as any)).rejects.toMatchObject({ code: 'WORK_NOT_FOUND' })
    const r = await requests.createRequest(asObra, { document: '45723174000110', modelId: null, contactEmail: 'w@t.com', workName: 'obra nova teste', urgency: 'normal', sendInvite: false } as any)
    expect((await requests.getRequest(asObra, r.id)).workName).toBe('Obra Nova Teste')
    await worksUC.saveWork(asDev, nova.id, { name: 'Obra Nova Teste', active: false })
    await expect(requests.createRequest(asObra, { document: '07526557000100', modelId: null, contactEmail: 'w2@t.com', workName: 'Obra Nova Teste', urgency: 'normal', sendInvite: false } as any)).rejects.toMatchObject({ code: 'WORK_NOT_FOUND' })
    // a solicitação antiga continua com o nome da obra desativada
    expect((await requests.getRequest(asObra, r.id)).workName).toBe('Obra Nova Teste')
  })
  describe('módulos independentes: Fornecedores/PJ × Pessoas Físicas/PF', () => {
    const CPF = '52998224725'
    let gestorPf: { id: string }
    let pfModel: { id: string }
    let pfType: { id: string }

    it('cada módulo tem cargos próprios; Dev geral vale nos dois, Dev do módulo só no dele', async () => {
      const base = await staff(users.analista, 'pf')
      const asPfAdmin = { ...base, ctx: { ...base.ctx, actor: { ...base.ctx.actor, permissions: ['users.manage'] } } }
      const roles = await settingsUC.saveRole(asPfAdmin, null, {
        name: 'Gestão PF',
        description: null,
        permissions: ['request.create', 'request.read.own', 'request.read.all', 'request.analyze', 'request.approve', 'supplier.read', 'model.read'],
      })
      // a lista do PF só tem cargos do PF (o Dev PF e o novo); os do PJ não aparecem
      expect(roles.map((r) => [r.key, r.module])).toEqual([
        ['dev-pf', 'pf'],
        ['pf-gestao-pf', 'pf'],
      ])
      const asPjAdmin = { ...(await staff(users.analista, 'pj')), ctx: { ...(await staff(users.analista, 'pj')).ctx, actor: { ...(await staff(users.analista, 'pj')).ctx.actor, permissions: ['users.manage'] } } }
      expect((await settingsUC.listRoles(asPjAdmin)).some((r) => r.key === 'pf-gestao-pf')).toBe(false)

      ;[gestorPf] = await db.insert(schema.users).values({ email: 'gestor.pf@t.com', fullName: 'Gestor PF', roles: ['pf-gestao-pf'] }).returning()
      const pf = (await staff(gestorPf, 'pf')).ctx.actor
      expect([pf.memberOf, pf.modules, pf.access.pj]).toEqual([['pf'], ['pf'], []])
      expect((await staff(users.analista, 'pf')).ctx.actor.permissions).toEqual([])

      const [devPf] = await db.insert(schema.users).values({ email: 'dev.pf@t.com', fullName: 'Dev PF', roles: ['dev-pf'] }).returning()
      const dp = (await staff(devPf, 'pf')).ctx.actor
      expect([dp.access.pf.length > 10, dp.access.pj, dp.memberOf]).toEqual([true, [], ['pf']])
      const [devGeral] = await db.insert(schema.users).values({ email: 'dev.geral@t.com', fullName: 'Dev Geral', roles: ['dev'] }).returning()
      const dg = (await staff(devGeral, 'pj')).ctx.actor
      expect([dg.globalDev, dg.memberOf, dg.access.pj.length === dg.access.pf.length]).toEqual([true, ['pj', 'pf'], true])
    })

    it('a mesma pessoa com cargos diferentes em cada módulo: permissão de um não vale no outro', async () => {
      // Obra no PJ (só abre e acompanha) + Gestão PF (aprova) no PF
      const [mista] = await db.insert(schema.users).values({ email: 'mista@t.com', fullName: 'Mista', roles: ['obra', 'pf-gestao-pf'] }).returning()
      const pj = (await staff(mista, 'pj')).ctx.actor
      const pf = (await staff(mista, 'pf')).ctx.actor
      expect(pj.permissions).toEqual(['request.create', 'request.read.own', 'evaluation.create'])
      expect(pf.permissions).toContain('request.approve')
      expect(pj.permissions).not.toContain('request.approve')
      await expect(suppliersUC.listSuppliers(await staff(mista, 'pj'), 'pj')).rejects.toMatchObject({ status: 403 })
    })

    it('usuários e tipos de documento são de cada módulo', async () => {
      const pfAdmin = { ...(await staff(gestorPf, 'pf')), ctx: { ...(await staff(gestorPf, 'pf')).ctx, actor: { ...(await staff(gestorPf, 'pf')).ctx.actor, permissions: ['users.manage', 'settings.manage', 'model.read'] } } }
      // pessoa que já é do PJ entra no PF: ganha o cargo do PF e mantém o do PJ
      await settingsUC.saveUser(pfAdmin, null, { fullName: 'Analista Teste', email: 'analista@t.com', roles: ['pf-gestao-pf'], active: true })
      const [ana] = await db.select().from(schema.users).where(eq(schema.users.email, 'analista@t.com'))
      expect(ana.roles.sort()).toEqual(['analista', 'pf-gestao-pf'])
      // a lista de usuários do PF mostra só os cargos do PF
      const pfUsers = await settingsUC.listUsers(pfAdmin)
      expect(pfUsers.find((u) => u.email === 'analista@t.com')?.roles).toEqual(['pf-gestao-pf'])
      expect(pfUsers.some((u) => u.email === 'obra@t.com')).toBe(false)
      // cargo do PJ não pode ser dado pelo painel do PF
      await expect(settingsUC.saveUser(pfAdmin, ana.id, { fullName: 'Analista Teste', email: 'analista@t.com', roles: ['aprovador'], active: true })).rejects.toMatchObject({ code: 'UNKNOWN_ROLE' })
      // tirar do PF não mexe no PJ
      await settingsUC.saveUser(pfAdmin, ana.id, { fullName: 'Analista Teste', email: 'analista@t.com', roles: [], active: true })
      expect((await db.select().from(schema.users).where(eq(schema.users.id, ana.id)))[0].roles).toEqual(['analista'])
      // o Dev do módulo só é dado por um Dev
      await expect(settingsUC.saveUser(pfAdmin, null, { fullName: 'X', email: 'x@t.com', roles: ['dev-pf'], active: true })).rejects.toMatchObject({ status: 403 })

      // tipos de documento: cada módulo com a sua lista
      pfType = (await settingsUC.saveDocumentType(pfAdmin, null, { name: 'RG ou CNH', description: null, hasExpiry: false, active: true, sort: 0 }))!
      expect((await settingsUC.listDocumentTypes(pfAdmin)).map((t) => t.name)).toEqual(['RG ou CNH'])
      expect((await settingsUC.listDocumentTypes(await staff(users.analista, 'pj'))).some((t) => t.name === 'RG ou CNH')).toBe(false)
      // modelo do PF só aceita tipo do PF e pessoa física
      await expect(settingsUC.saveModel(pfAdmin, null, { name: 'Errado', description: null, personKind: 'PF', expectedCnaePrefixes: [], active: true, requirements: [{ documentTypeId: tCnpj.id, required: true, instructions: '' }] } as any)).rejects.toMatchObject({ code: 'WRONG_MODULE' })
      await expect(settingsUC.saveModel(pfAdmin, null, { name: 'Errado', description: null, personKind: 'PJ', expectedCnaePrefixes: [], active: true, requirements: [] } as any)).rejects.toMatchObject({ code: 'WRONG_MODULE' })
      pfModel = await settingsUC.saveModel(pfAdmin, null, { name: 'Pessoa física', description: 'x', personKind: 'PF', expectedCnaePrefixes: [], active: true, requirements: [{ documentTypeId: pfType.id, required: true, instructions: '' }] } as any)
    })

    it('cada módulo aceita só o seu documento e só quem tem o módulo', async () => {
      const asPf = await staff(gestorPf, 'pf')
      await expect(requests.createRequest(await staff(users.analista, 'pj'), { module: 'pj', document: CPF, contactEmail: 'p@t.com', urgency: 'normal', sendInvite: false } as any)).rejects.toMatchObject({ code: 'WRONG_MODULE' })
      await expect(requests.createRequest(asPf, { module: 'pf', document: '45723174000110', contactEmail: 'p@t.com', urgency: 'normal', sendInvite: false } as any)).rejects.toMatchObject({ code: 'WRONG_MODULE' })
      await expect(requests.createRequest(await staff(users.analista, 'pf'), { module: 'pf', document: CPF, contactEmail: 'p@t.com', urgency: 'normal', sendInvite: false } as any)).rejects.toMatchObject({ status: 403 })
      await expect(requests.listRequests(await staff(users.analista, 'pf'), 'all', 'pf')).rejects.toMatchObject({ status: 403 })
      await expect(requests.listRequests(await staff(gestorPf, 'pj'), 'all', 'pj')).rejects.toMatchObject({ status: 403 })
    })

    it('fluxo PF: sem risco e sem qualificação, avisos só para a gestão PF e dados pessoais no UAU', async () => {
      const asPf = await staff(gestorPf, 'pf')
      mails.length = 0
      const r = await requests.createRequest(asPf, { module: 'pf', document: CPF, modelId: pfModel.id, contactEmail: 'pessoa@t.com', urgency: 'normal', sendInvite: true } as any)
      const d0 = await requests.getRequest(asPf, r.id)
      expect([d0.module, d0.status, d0.model?.id]).toEqual(['pf', 'aguardando_fornecedor', pfModel.id])
      // convite do PF: sem menção a fornecedor
      const inviteMail = mails.find((m) => m.to.includes('pessoa@t.com'))!
      expect(inviteMail.subject).toMatch(/cadastro de pessoa física/)
      expect(`${inviteMail.subject} ${inviteMail.html}`).not.toMatch(/fornecedor/i)

      // a gestão PJ não enxerga a solicitação de PF (o servidor recorta o usuário para o módulo PF)
      await expect(requests.getRequest(await staff(users.aprovador, 'pf'), r.id)).rejects.toMatchObject({ status: 404 })
      expect((await requests.listRequests(await staff(users.aprovador, 'pj'), 'all', 'pj')).some((x) => x.id === r.id)).toBe(false)

      const [invite] = (await db.select().from(schema.invites).where(eq(schema.invites.requestId, r.id))).filter((i: any) => !i.revokedAt)
      const profile = {
        document: CPF,
        legalName: 'MARIA DA SILVA',
        email: 'pessoa@t.com',
        phoneDdd: '62',
        phoneNumber: '999990000',
        address: { cep: '74003010', street: 'Rua 2', number: '5', complement: null, district: 'Centro', city: 'Goiânia', uf: 'GO' },
        bank: null,
        pix: null,
      }
      await portal.portalUpload(supplierPortal(), invite.id, { file: pdf('rg.pdf'), documentTypeId: pfType.id, issuedAt: null, expiresAt: null })
      await portal.saveProfile(supplierPortal(), invite.id, profile)
      await expect(portal.portalSubmit(supplierPortal(), invite.id)).rejects.toBeTruthy() // falta nascimento, sexo, estado civil e RG
      await portal.saveProfile(supplierPortal(), invite.id, { ...profile, person: { birthDate: '1990-04-12', sex: 'F', maritalStatus: 'casado', rgNumber: '1234567', rgIssuer: 'SSP', rgUf: 'GO' } })
      mails.length = 0
      await portal.portalSubmit(supplierPortal(), invite.id)
      expect(mails.some((m) => m.to.includes('gestor.pf@t.com'))).toBe(true)
      expect(mails.some((m) => m.to.includes('aprovador@t.com') || m.to.includes('dev.pf@t.com') || m.to.includes('dev.geral@t.com'))).toBe(false)

      await expect(qualificationUC.saveQualification(asPf, r.id, { answers: [{ questionId: '00000000-0000-4000-8000-000000000000', answer: 'sim' }] })).rejects.toMatchObject({ code: 'NO_QUALIFICATION_PF' })
      const d1 = await requests.getRequest(asPf, r.id)
      await expect(suppliersUC.runRiskCheck(asPf, d1.supplier.id, r.id)).rejects.toMatchObject({ code: 'NO_RISK_PF' })
      for (const doc of d1.documents) await requests.reviewDocument(asPf, r.id, doc.id, { status: 'aprovado', note: null, issuedAt: null, expiresAt: null })
      await requests.sendToApproval(asPf, r.id)

      uauCalls.length = 0
      await approval.approveRequest(asPf, r.id)
      const save = uauCalls.find((c) => c.route.endsWith('GravarPessoa'))?.body
      expect(save.info_pes).toMatchObject({ tipo_pes: 0, cpf_pes: CPF, dtnasc_pes: '1990-04-12T00:00:00' })
      expect(save.info_pesfis).toMatchObject({ sexo_pf: 1, estciv_pf: 2, doc_pf: '1234567', tdoc_pf: 'RG' })
      const attach = uauCalls.find((c) => c.route.endsWith('AnexarArquivosBase64Request'))?.body
      expect(attach.lista_arquivos.map((x: any) => x.NomeArquivo)).toEqual(['rg'])
      expect((await requests.getRequest(asPf, r.id)).status).toBe('gravado_uau')
    })

    it('base, painel, ficha, modelos e avaliação respeitam o módulo', async () => {
      const asPf = await staff(gestorPf, 'pf')
      const people = await suppliersUC.listSuppliers(asPf, 'pf')
      expect(people.map((x) => x.document)).toEqual([CPF])
      expect((await suppliersUC.listSuppliers(await staff(users.analista, 'pj'), 'pj')).some((x) => x.document === CPF)).toBe(false)
      await expect(suppliersUC.getSupplier(await staff(users.analista, 'pf'), people[0]!.id)).rejects.toMatchObject({ status: 403 })
      const dash = await dashboard.getDashboard(asPf, 'pf')
      expect([dash.suppliers.total, dash.requests.byStatus.gravado_uau]).toEqual([1, 1])
      expect(await suppliersUC.searchEvaluableSuppliers(await staff(users.obra, 'pj'), 'maria')).toEqual([])
      await expect(suppliersUC.createEvaluation(await staff(users.analista, 'pj'), { supplierId: people[0]!.id, workName: 'Ipanema 212', scores: {}, comment: null } as any)).rejects.toMatchObject({ code: 'NO_EVALUATION_PF' })
      expect((await settingsUC.listModels(asPf, { module: 'pf' })).map((m) => m.name)).toEqual(['Pessoa física'])
    })

    it('importação do UAU por módulo: o PF traz só pessoas físicas ativas com CPF válido', async () => {
      const person = (cod: number, doc: string, tipo: number, extra: Record<string, unknown> = {}) => ({ CodigoPessoa: cod, NomePessoa: `PESSOA ${cod}`, NomeFantasia: '', TipoPessoa: tipo, CpfPessoa: doc, AtivoInativo: 0, EmailPessoa: '', ...extra })
      uauPeople = [
        person(1, '39053344705', 0),
        person(2, '39053344705', 0), // CPF repetido: fica o código 2
        person(3, '11111111111', 0), // CPF inválido
        person(4, '15350946056', 0, { AtivoInativo: 1 }), // inativa
        person(5, '06990590000123', 1), // empresa: é do PJ
        person(7, CPF, 0), // já existe no app com código mais novo (9999, da gravação): fica como está
      ]
      const [devPf] = await db.insert(schema.users).values({ email: 'importa.pf@t.com', fullName: 'Importa PF', roles: ['dev-pf'] }).returning()
      const asDevPf = await staff(devPf, 'pf')
      let cursor = { from: 0, emptyStreak: 0 }
      const total = { created: 0, updated: 0, outro_tipo: 0, invalida: 0, inativa: 0, duplicada: 0 }
      for (;;) {
        const r = await suppliersUC.syncFromUau(asDevPf, cursor)
        total.created += r.created
        total.updated += r.updated
        for (const k of ['outro_tipo', 'invalida', 'inativa', 'duplicada'] as const) total[k] += r.skipped[k]
        cursor = { from: r.from, emptyStreak: r.emptyStreak }
        if (r.done) break
      }
      expect(total).toEqual({ created: 1, updated: 0, outro_tipo: 1, invalida: 1, inativa: 1, duplicada: 1 })
      const people = await suppliersUC.listSuppliers(asDevPf, 'pf')
      expect(people.map((p) => p.document).sort()).toEqual(['39053344705', CPF].sort())
      expect(people.find((p) => p.document === CPF)?.uauCodPes).toBe(9999)
      // a empresa não entrou em lugar nenhum; e quem não tem o PF não importa no PF
      expect((await suppliersUC.listSuppliers(await staff(users.analista, 'pj'), 'pj')).some((x) => x.document === '06990590000123')).toBe(false)
      await expect(suppliersUC.syncFromUau(await staff(users.analista, 'pf'), { from: 0, emptyStreak: 0 })).rejects.toMatchObject({ status: 403 })
      uauPeople = []
    })
  })
})
