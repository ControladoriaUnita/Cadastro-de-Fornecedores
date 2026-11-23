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
import * as requests from './application/use-cases/requests'
import * as suppliersUC from './application/use-cases/suppliers'
import { loadActor } from './infrastructure/auth'
import * as schema from './infrastructure/db/schema'

/* eslint-disable @typescript-eslint/no-explicit-any -- dublês de teste */

const CNPJ = '11222333000181'
const CNPJ2 = '11444777000161'
const CNPJ3 = '19131243000197'
const DAY = 86_400_000
const isoIn = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10)
const pdf = (name: string) => new File([Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')], name, { type: 'application/pdf' })

const mails: { to: string[]; subject: string }[] = []
const uauCalls: { route: string; body: any }[] = []
const files = new Map<string, Buffer>()

const mailer = {
  provider: 'graph' as const,
  async send(m: { to: string[]; subject: string }) {
    mails.push({ to: m.to, subject: m.subject })
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
    if (route.endsWith('ListarDiretorios')) return { route, status: 200, ok: true, ms: 1, data: [] }
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

const staff = async (u: { id: string }) =>
  ({ db, uau, mailer, storage, company, sanctions, ctx: { correlationId: 'teste', actor: await loadActor(db, u.id), now: () => new Date() } }) as any
const supplierPortal = () => ({ db, uau, mailer, storage, company, sanctions, now: () => new Date() }) as any
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
    expect(asObra.ctx.actor.permissions).toEqual(['request.create', 'request.read.own'])
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
    await requests.sendToApproval(asAnalyst, requestId)
    uauCalls.length = 0
    mails.length = 0
    await approval.approveRequest(await staff(users.aprovador), requestId)

    const save = uauCalls.find((c) => c.route.endsWith('GravarPessoa'))?.body
    expect(save.info_pes.dtnasc_pes).toBe('2010-05-03T00:00:00')
    expect(save.info_pesendereco_principal).toMatchObject({ Tipo_pend: 0, NumEnd_pend: '' })
    expect(save.infopesendereco_cobranca).toMatchObject({ Tipo_pend: 1, NumEnd_pend: '', Endereco_pend: 'Praça Cívica', CEP_pend: '74003010' })
    const attach = uauCalls.find((c) => c.route.endsWith('AnexarArquivosBase64Request'))?.body
    expect(attach.empresa).toBe(1)
    expect(attach.lista_arquivos.map((f: any) => f.NomeArquivo)).toEqual(expect.arrayContaining(['Cartao CNPJ', 'Certidao Federal']))

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
})
