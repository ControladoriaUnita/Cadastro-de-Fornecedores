import { describe, expect, it } from 'vitest'
import { evaluationSchema } from '../contracts'
import { formatDocument, isValidCnpj, isValidCpf, personKindOf } from './document-number'
import { documentChecklist, expiryState } from './documents'
import { monthKey, monthLabel, SCORE_LABELS, SCORE_MAX, scoreBand, supplierScores, weightedAverage } from './evaluation'
import { availableActions, transition, WorkflowError } from './request/workflow'
import { defaultRuleConfigs, evaluateRisk, type RiskFacts } from './risk'
import { DEFAULT_ROLES, permissionsFor, PERMISSIONS, roleKeyFromName } from './roles'
import { supplierProfileSchema } from './supplier'
import { addressNumber, buildAttachBody, buildBankBody, buildSavePersonBody, extractPersonCode, findSupplierFolder, joinFolder, supplierFolderName, UAU_MARITAL_CODES, UAU_SEX_CODES, uauRefusal } from './uau-payload'
import { firstValidEmail, mapUauPerson, selectUauSuppliers } from './uau-suppliers'

describe('CNPJ/CPF', () => {
  it('valida dígitos', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true)
    expect(isValidCnpj('11222333000182')).toBe(false)
    expect(isValidCnpj('00000000000000')).toBe(false)
    expect(isValidCpf('529.982.247-25')).toBe(true)
    expect(isValidCpf('52998224726')).toBe(false)
  })
  it('identifica o tipo e formata', () => {
    expect(personKindOf('11222333000181')).toBe('PJ')
    expect(personKindOf('52998224725')).toBe('PF')
    expect(personKindOf('123')).toBeNull()
    expect(formatDocument('11222333000181')).toBe('11.222.333/0001-81')
  })
})

describe('workflow da solicitação', () => {
  const analyst = { id: 'a', permissions: permissionsFor(['analista'], DEFAULT_ROLES) }
  const requester = { id: 'r', permissions: permissionsFor(['obra'], DEFAULT_ROLES) }
  const approver = { id: 'p', permissions: permissionsFor(['aprovador'], DEFAULT_ROLES) }

  it('obra só cancela o próprio pedido', () => {
    expect(availableActions('solicitado', requester, 'r')).toEqual(['cancel'])
    expect(availableActions('solicitado', requester, 'outro')).toEqual([])
  })
  it('percorre o caminho feliz', () => {
    let s = transition('solicitado', 'invite', analyst, { requesterId: 'r' })
    expect(s).toBe('aguardando_fornecedor')
    s = transition(s, 'supplier_submit', 'supplier', { requesterId: 'r' })
    expect(s).toBe('em_analise')
    s = transition(s, 'send_to_approval', analyst, { requesterId: 'r' })
    expect(s).toBe('aguardando_aprovacao')
    s = transition(s, 'approve', approver, { requesterId: 'r' })
    expect(s).toBe('gravado_uau')
  })
  it('analista não aprova; pendência exige motivo; fornecedor não age fora da vez', () => {
    expect(() => transition('aguardando_aprovacao', 'approve', analyst, { requesterId: 'r' })).toThrow(WorkflowError)
    expect(() => transition('em_analise', 'request_changes', analyst, { requesterId: 'r' })).toThrow(/motivo/)
    expect(() => transition('em_analise', 'supplier_submit', 'supplier', { requesterId: 'r' })).toThrow(WorkflowError)
  })
  it('obra abre e acompanha as próprias solicitações e avalia', () => {
    expect(permissionsFor(['obra'], DEFAULT_ROLES)).toEqual(['request.create', 'request.read.own', 'evaluation.create'])
  })
  it('dev tem todas as permissões, mesmo sem estar no catálogo', () => {
    expect(permissionsFor(['dev'], [])).toEqual(expect.arrayContaining(Object.values(PERMISSIONS)))
  })
  it('cargo novo soma permissões e ignora permissões desconhecidas', () => {
    const catalog = [{ key: 'compras', permissions: ['request.create', 'x.inexistente'] as never[] }, ...DEFAULT_ROLES]
    expect(permissionsFor(['compras', 'analista'], catalog)).toEqual(expect.arrayContaining(['request.create', 'supplier.read']))
    expect(permissionsFor(['compras'], catalog)).toEqual(['request.create'])
    expect(permissionsFor(['cargo-apagado'], catalog)).toEqual([])
  })
  it('gera a chave do cargo a partir do nome', () => {
    expect(roleKeyFromName('Gerente de Obras')).toBe('gerente-de-obras')
    expect(roleKeyFromName('Engenharia — Orçamentos')).toBe('engenharia-orcamentos')
  })
})

describe('documentos', () => {
  const today = new Date('2026-06-10T12:00:00')
  it('calcula vencimento', () => {
    expect(expiryState(null, today)).toBe('sem_validade')
    expect(expiryState('2026-06-09', today)).toBe('vencido')
    expect(expiryState('2026-06-30', today)).toBe('vencendo')
    expect(expiryState('2026-12-31', today)).toBe('valido')
  })
  it('checklist considera o envio mais recente', () => {
    const reqs = [
      { documentTypeId: 'a', required: true },
      { documentTypeId: 'b', required: true },
      { documentTypeId: 'c', required: false },
    ]
    const docs = [
      { documentTypeId: 'a', reviewStatus: 'reprovado' as const, expiresAt: null },
      { documentTypeId: 'a', reviewStatus: 'aprovado' as const, expiresAt: null },
    ]
    const c = documentChecklist(reqs, docs, today)
    expect(c.missing).toEqual(['b'])
    expect(c.rejected).toEqual([])
    expect(c.complete).toBe(false)
  })
})

describe('risco', () => {
  const base: RiskFacts = {
    situacaoCadastral: 'ATIVA',
    dataAbertura: '2015-01-01',
    capitalSocial: 500000,
    mei: false,
    cnaes: ['4120400'],
    ceis: { count: 0 },
    cnep: { count: 0 },
    expectedCnaePrefixes: ['41', '42', '43'],
    expiredRequiredDocuments: 0,
  }
  const today = new Date('2026-06-10')
  it('empresa regular = risco baixo', () => {
    const r = evaluateRisk(defaultRuleConfigs(), base, today)
    expect(r.level).toBe('baixo')
    expect(r.blocked).toBe(false)
  })
  it('CNPJ baixado bloqueia', () => {
    const r = evaluateRisk(defaultRuleConfigs(), { ...base, situacaoCadastral: 'BAIXADA' }, today)
    expect(r.level).toBe('alto')
    expect(r.blocked).toBe(true)
  })
  it('empresa recente e CNAE fora do modelo geram alerta', () => {
    const r = evaluateRisk(defaultRuleConfigs(), { ...base, dataAbertura: '2026-03-01', cnaes: ['4744099'] }, today)
    expect(r.level).toBe('medio')
    expect(r.findings.filter((f) => f.outcome === 'hit').map((f) => f.key)).toEqual(['empresa_recente', 'cnae_divergente_modelo'])
  })
  it('sem chave da Transparência fica "não consultado", sem bloquear', () => {
    const r = evaluateRisk(defaultRuleConfigs(), { ...base, ceis: null, cnep: null }, today)
    expect(r.findings.find((f) => f.key === 'sancao_ceis')?.outcome).toBe('unchecked')
    expect(r.blocked).toBe(false)
  })
  it('regra desligada não é avaliada', () => {
    const cfg = defaultRuleConfigs().map((c) => (c.key === 'cnpj_nao_ativo' ? { ...c, severity: 'desligada' as const } : c))
    const r = evaluateRisk(cfg, { ...base, situacaoCadastral: 'BAIXADA' }, today)
    expect(r.blocked).toBe(false)
  })
})

describe('avaliação', () => {
  it('média ponderada', () => {
    const criteria = [
      { id: 'q', weight: 3 },
      { id: 'p', weight: 1 },
    ]
    expect(weightedAverage(criteria, { q: 5, p: 1 })).toBe(4)
    expect(weightedAverage(criteria, {})).toBeNull()
  })
})

describe('payload do UAU', () => {
  const profile = supplierProfileSchema.parse({
    document: '11.222.333/0001-81',
    legalName: 'Construtora Exemplo Ltda',
    tradeName: 'Exemplo',
    email: 'Contato@Exemplo.com.br',
    phoneDdd: '11',
    phoneNumber: '91234-5678',
    simplesNacional: false,
    address: { cep: '01310-100', street: 'Av. Paulista', number: '1000', district: 'Bela Vista', city: 'São Paulo', uf: 'SP' },
    bank: { bankCode: '341', agency: '1234', account: '12345-6', accountType: 0 },
    pix: null,
  })
  it('monta GravarPessoa para PJ, confirmada e ativa', () => {
    const body = buildSavePersonBody(profile, { user: 'API', now: new Date('2026-01-01T00:00:00Z') })
    expect(body.info_pes).toMatchObject({ cod_pes: 0, tipo_pes: 1, cpf_pes: '11222333000181', status_pes: 2, atinat_pes: 0, nome_pes: 'CONSTRUTORA EXEMPLO LTDA', email_pes: 'contato@exemplo.com.br' })
    expect('infopes_jur' in body).toBe(true)
    expect(body.info_pesendereco_principal).toMatchObject({ Tipo_pend: 0, CEP_pend: '01310100', UF_pend: 'SP' })
  })
  it('manda fundação, endereço de cobrança e número vazio quando não houver', () => {
    const body = buildSavePersonBody({ ...profile, address: { ...profile.address, number: 'S/N' } }, { user: 'API', now: new Date('2026-01-01T00:00:00Z'), foundedAt: '2010-05-03' })
    expect(body.info_pes).toMatchObject({ dtnasc_pes: '2010-05-03T00:00:00' })
    expect(body.info_pesendereco_principal).toMatchObject({ Tipo_pend: 0, NumEnd_pend: '' })
    expect(body.infopesendereco_cobranca).toMatchObject({ Tipo_pend: 1, NumEnd_pend: '', CEP_pend: '01310100', Endereco_pend: 'Av. Paulista' })
    expect(buildSavePersonBody(profile, { user: 'API', now: new Date() }).info_pes.dtnasc_pes).toBeUndefined()
    expect(['s/n', 'SN', 'S/N.', 'sem número', '0', '', '1000'].map(addressNumber)).toEqual(['', '', '', '', '', '', '1000'])
  })
  it('monta conta bancária e anexos', () => {
    expect(buildBankBody(profile, 123)).toMatchObject({ codigoPessoa: 123, banco: 341, padrao: true, tipo: 0 })
    const att = buildAttachBody([{ fileName: 'cnpj.pdf', extension: 'pdf', base64: 'AAA' }], { codPes: 123, folder: 'FORN\\1', user: 'API', company: 1 })
    expect(att).toMatchObject({ empresa: 1 })
    expect(att.lista_arquivos[0]).toMatchObject({ Identificador: 'Pessoas 123', Origem: 1, NomeArquivo: 'cnpj', Extension: 'pdf' })
  })
  it('lê o código da pessoa em formatos diferentes', () => {
    expect(extractPersonCode([{ cod_pes: 77 }])).toBe(77)
    expect(extractPersonCode({ Dados: [{ CodigoPessoa: '88' }] })).toBe(88)
    expect(extractPersonCode('99')).toBe(99)
    expect(extractPersonCode({ mensagem: 'ok' })).toBeNull()
  })
  it('monta a pasta no padrão de Suprimentos e reaproveita a existente', () => {
    expect(supplierFolderName(5539, 'Pluma Içamentos Ltda.')).toBe('5539 - PLUMA ICAMENTOS LTDA.')
    expect(supplierFolderName(12, 'A/B: C*D')).toBe('12 - A B C D')
    expect(findSupplierFolder(['5539 - PLUMA ICAMENTOS LTDA', '55390 - OUTRA', '940 - Mastermade'], 940)).toBe('940 - Mastermade')
    expect(findSupplierFolder(['55390 - OUTRA'], 5539)).toBeNull()
    expect(joinFolder('1-UNITA\\SUP\\', '7 - X')).toBe('1-UNITA\\SUP\\7 - X')
  })
})

describe('Base de fornecedores do UAU', () => {
  const pj = (cod: number, cnpj: string, extra: Record<string, unknown> = {}) => ({
    CodigoPessoa: cod,
    NomePessoa: '  EMPRESA   X  ',
    NomeFantasia: '',
    TipoPessoa: 1,
    CpfPessoa: cnpj,
    AtivoInativo: 0,
    EmailPessoa: 'Compras@X.com.br; outro@x.com',
    SenhaLoginPessoa: 'nunca-lida',
    ...extra,
  })
  it('lê só pessoa jurídica ativa e nunca a senha', () => {
    const s = mapUauPerson(pj(10, '11.222.333/0001-81'))
    expect(s).toEqual({ codPes: 10, document: '11222333000181', legalName: 'EMPRESA X', tradeName: null, email: 'compras@x.com.br' })
    expect(mapUauPerson(pj(11, '52998224725', { TipoPessoa: 0 }))).toBe('outro_tipo')
    expect(mapUauPerson(pj(12, '11222333000181', { AtivoInativo: 1 }))).toBe('inativa')
    expect(mapUauPerson(pj(13, '123'))).toBe('invalida')
  })
  it('pega o primeiro e-mail válido', () => {
    expect(firstValidEmail('sem email, a@b.com')).toBe('a@b.com')
    expect(firstValidEmail(null)).toBeNull()
  })
  it('tira CNPJ repetido ficando com o código mais recente', () => {
    const r = selectUauSuppliers([pj(5, '11222333000181'), pj(9, '11222333000181'), pj(7, '11222333000181'), pj(8, '52998224725', { TipoPessoa: 0 })])
    expect(r.suppliers.map((s) => s.codPes)).toEqual([9])
    expect(r.skipped).toMatchObject({ duplicada: 2, outro_tipo: 1 })
  })
  it('módulo PF: lê só pessoa física ativa com CPF válido (sem nome fantasia)', () => {
    const pf = (cod: number, cpf: string, extra: Record<string, unknown> = {}) => pj(cod, cpf, { TipoPessoa: 0, NomeFantasia: 'APELIDO', ...extra })
    expect(mapUauPerson(pf(20, '529.982.247-25'), 'PF')).toEqual({ codPes: 20, document: '52998224725', legalName: 'EMPRESA X', tradeName: null, email: 'compras@x.com.br' })
    expect(mapUauPerson(pj(21, '11222333000181'), 'PF')).toBe('outro_tipo')
    expect(mapUauPerson(pf(22, '11111111111'), 'PF')).toBe('invalida')
    expect(mapUauPerson(pf(23, '52998224725', { AtivoInativo: 1 }), 'PF')).toBe('inativa')
    const r = selectUauSuppliers([pf(30, '52998224725'), pf(31, '52998224725'), pj(32, '11222333000181')], 'PF')
    expect(r.suppliers.map((s) => s.codPes)).toEqual([31])
    expect(r.skipped).toMatchObject({ duplicada: 1, outro_tipo: 1 })
  })
})

describe('Médias de avaliação', () => {
  const now = new Date('2026-11-23T15:00:00Z')
  it('separa média geral e média do mês (horário de Brasília)', () => {
    const s = supplierScores(
      [
        { average: 5, createdAt: '2026-11-02T12:00:00Z' },
        { average: 3, createdAt: '2026-11-20T12:00:00Z' },
        { average: 2, createdAt: '2026-10-10T12:00:00Z' },
        { average: null, createdAt: '2026-11-21T12:00:00Z' },
        // 01/11 às 01h UTC ainda é 31/10 em Brasília
        { average: 1, createdAt: '2026-11-01T01:00:00Z' },
      ],
      now,
    )
    expect(s.overall).toBe(2.75)
    expect(s.overallCount).toBe(4)
    expect([s.month, s.monthCount]).toEqual([4, 2])
    expect(s.monthly[0]).toEqual({ month: '2026-11', average: 4, count: 2 })
    expect(s.monthly[1]).toEqual({ month: '2026-10', average: 1.5, count: 2 })
    expect(s.monthly).toHaveLength(12)
    expect(s.monthly[11]!.month).toBe('2025-12')
  })
  it('sem avaliações no mês, a média do mês fica vazia', () => {
    const s = supplierScores([{ average: 4, createdAt: '2026-09-01T12:00:00Z' }], now)
    expect([s.overall, s.month, s.monthCount]).toEqual([4, null, 0])
  })
  it('formata o mês', () => {
    expect(monthKey('2026-01-01T02:00:00Z')).toBe('2025-12')
    expect(monthLabel('2026-11')).toBe('nov/2026')
  })
})

describe('Escala de notas 1 a 10', () => {
  it('vai até 10, com rótulo para cada nota e faixas de cor proporcionais', () => {
    expect(SCORE_MAX).toBe(10)
    expect(Object.keys(SCORE_LABELS)).toHaveLength(10)
    expect([9.2, 7, 5.5, 4.9, null].map(scoreBand)).toEqual(['otimo', 'bom', 'atencao', 'critico', null])
    const base = { supplierId: '00000000-0000-4000-8000-000000000000', workName: 'Obra', comment: null }
    const c = '00000000-0000-4000-8000-000000000001'
    expect(evaluationSchema.safeParse({ ...base, scores: { [c]: 10 } }).success).toBe(true)
    expect(evaluationSchema.safeParse({ ...base, scores: { [c]: 11 } }).success).toBe(false)
    expect(evaluationSchema.safeParse({ ...base, scores: { [c]: 0 } }).success).toBe(false)
  })
})

describe('Recusa do UAU com HTTP 200', () => {
  it('lê Sucesso: false e a mensagem; resposta normal não é recusa', () => {
    const data = { CodigoPessoa: 0, Sucesso: false, Mensagem: 'O campo Naturalidade deve ser preenchido.\r\nO limite Do campo Naturalidade é de 40 caracteres.', QuantidadeMensagens: 2 }
    expect(uauRefusal(data)).toBe('O campo Naturalidade deve ser preenchido. O limite Do campo Naturalidade é de 40 caracteres.')
    expect(uauRefusal([{ cod_pes: 123 }])).toBeNull()
    expect(uauRefusal('')).toBeNull()
  })
})

describe('Códigos de pessoa física do UAU (swagger PesFis)', () => {
  it('sexo e estado civil seguem a documentação da API', () => {
    expect(UAU_SEX_CODES).toEqual({ M: 0, F: 1 })
    expect(UAU_MARITAL_CODES).toEqual({ separado: 0, solteiro: 1, casado: 2, viuvo: 4, divorciado: 5, uniao_estavel: 1 })
  })
})
