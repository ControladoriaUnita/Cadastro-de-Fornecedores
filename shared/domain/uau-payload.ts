/**
 * Monta os corpos enviados ao UAU a partir da ficha do fornecedor.
 * Rotas (todas POST em <base>/api/v1.0/...):
 *   Pessoas/ConsultarDadosPessoaPorCpfCnpjEStatus → evita duplicidade
 *   Pessoas/GravarPessoa                          → cria a pessoa (cod_pes = 0)
 *   Pessoas/ManterTelefone                        → telefone principal
 *   Pessoas/GravarContaBancaria                   → conta padrão
 *   Anexo/AnexarArquivosBase64Request             → documentos, chave "Pessoas <cod_pes>"
 */
import { onlyDigits } from './document-number'
import type { MaritalStatus, Sex, SupplierProfile } from './supplier'

export const UAU_ROUTES = {
  findByDocument: 'Pessoas/ConsultarDadosPessoaPorCpfCnpjEStatus',
  findByCondition: 'Pessoas/ConsultarPessoasPorCondicao',
  savePerson: 'Pessoas/GravarPessoa',
  savePhone: 'Pessoas/ManterTelefone',
  saveBank: 'Pessoas/GravarContaBancaria',
  attachFiles: 'Anexo/AnexarArquivosBase64Request',
  listFiles: 'Anexo/ListaArquivoPorChave',
  listFolders: 'Anexo/ListarDiretorios',
} as const

/** Situação no UAU: 2 = Confirmado (decisão: o fornecedor entra pronto para uso). */
export const UAU_STATUS_CONFIRMADO = 2
/** 2 = Externo */
export const UAU_EXTERNO = 2

const cut = (v: string | null | undefined, max: number) => (v ? v.slice(0, max) : undefined)

/**
 * GravarPessoa é um método antigo do UAU: `dspes_tel_json` precisa vir como texto JSON cuja PRIMEIRA
 * linha é sempre esta estrutura de tipos .NET (Swagger, descrição da rota); sem ela o UAU devolve HTTP 500.
 * Os telefones em si vão depois, por Pessoas/ManterTelefone.
 */
const NET = (t: string) => `System.${t}, mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089`
export const UAU_PHONE_JSON_HEADER = JSON.stringify([
  {
    PesTel: [
      {
        ddd_tel: NET('String'),
        fone_tel: NET('String'),
        ram_tel: NET('String'),
        tipo_tel: NET('Byte'),
        TipoTel_tel: NET('String'),
        ExisteTel_tel: NET('Boolean'),
        Principal_tel: NET('Byte'),
      },
    ],
  },
])

/** "S/N", "SN", "sem número"… → vazio (o UAU fica com o número em branco). */
export function addressNumber(n: string | null | undefined): string {
  const v = (n ?? '').trim()
  return !v || /^(s\.?\s*\/?\s*n\.?|sem\s*n(u|ú)mero|0+)$/i.test(v) ? '' : v.slice(0, 10)
}

/** Data de abertura da Receita ("2010-05-03") → data aceita pelo UAU no campo Fundação. */
function foundationDate(v: string | null | undefined): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? '')
  return m ? `${m[1]}-${m[2]}-${m[3]}T00:00:00` : undefined
}

/**
 * Códigos do UAU para pessoa física. A API não documenta as listas: CONFIRMAR NO TESTE REAL
 * (abrir a pessoa gravada na tela do UAU e conferir sexo e estado civil) e ajustar aqui se preciso.
 */
export const UAU_SEX_CODES: Record<Sex, number> = { M: 0, F: 1 }
export const UAU_MARITAL_CODES: Record<MaritalStatus, number> = { solteiro: 1, casado: 2, separado: 3, divorciado: 4, viuvo: 5, uniao_estavel: 1 }

/** Bloco de pessoa física: com os dados informados no CPF; para CNPJ fica como já validado no UAU. */
function pesFis(p: SupplierProfile) {
  if (p.document.length !== 11 || !p.person) return { cod_pf: 0, sexo_pf: 0, indicativofiscal_pf: 0 }
  const x = p.person
  return {
    cod_pf: 0,
    sexo_pf: UAU_SEX_CODES[x.sex],
    estciv_pf: UAU_MARITAL_CODES[x.maritalStatus],
    uniaoestavel_pf: x.maritalStatus === 'uniao_estavel',
    doc_pf: x.rgNumber.slice(0, 20),
    tdoc_pf: 'RG',
    indicativofiscal_pf: 0,
  }
}

export function buildSavePersonBody(p: SupplierProfile, opts: { user: string; now: Date; foundedAt?: string | null }) {
  const pj = p.document.length === 14
  const address = (tipo: 0 | 1) => ({
    CodPes_pend: 0,
    Tipo_pend: tipo, // 0 = principal, 1 = cobrança (mesmo endereço informado pelo fornecedor)
    Endereco_pend: cut(p.address.street, 120),
    NumEnd_pend: addressNumber(p.address.number),
    ComplEndereco_pend: cut(p.address.complement, 60),
    Bairro_pend: cut(p.address.district, 60),
    Cidade_pend: cut(p.address.city, 60),
    UF_pend: p.address.uf,
    CEP_pend: p.address.cep,
  })
  return {
    nao_validar_campos_obrigatorios: false,
    // Objetos, não listas (Swagger GravarPessoaRequest): lista chega vazia e o UAU responde "info_pes é obrigatório"
    info_pes: {
      cod_pes: 0,
      nome_pes: p.legalName.toUpperCase().slice(0, 100),
      tipo_pes: pj ? 1 : 0,
      cpf_pes: onlyDigits(p.document),
      dtcad_pes: opts.now.toISOString(),
      // PJ: campo "Fundação" = abertura do CNPJ na Receita · PF: data de nascimento informada
      dtnasc_pes: pj ? foundationDate(opts.foundedAt) : foundationDate(p.person?.birthDate),
      intext_pes: UAU_EXTERNO,
      usrcad_pes: opts.user,
      status_pes: UAU_STATUS_CONFIRMADO,
      atinat_pes: 0,
      email_pes: p.email,
      endwww_pes: p.website ?? undefined,
      nomefant_pes: p.tradeName?.toUpperCase() ?? undefined,
      inscrest_pes: p.stateRegistration ?? undefined,
      inscrmunic_pes: p.municipalRegistration ?? undefined,
      cnae_pes: p.mainCnae ? onlyDigits(p.mainCnae) : undefined,
      cadastradoprefeituragyn_pes: false,
      habilitadoriscosacado_pes: false,
    },
    // O exemplo oficial (Postman da Globaltec) manda SEMPRE os dois blocos; sem um deles o UAU devolve HTTP 500.
    // O controller lê alguns números com .Value: vazios dão "O objeto nulo deve ter um valor" (HTTP 500).
    info_pesfis: pesFis(p),
    infopes_jur: { cod_pj: 0, natureza_pj: 0, contato_pj: pj ? (p.contactName ?? undefined) : undefined, optantesimples_pj: pj ? (p.simplesNacional ?? undefined) : undefined },
    info_pesendereco_principal: address(0),
    infopesendereco_cobranca: address(1),
    dspes_tel_json: UAU_PHONE_JSON_HEADER,
  }
}

export function buildPhoneBody(p: SupplierProfile, codPes: number) {
  return {
    Numero: codPes,
    Telefones: [{ DDD: p.phoneDdd, Telefone: p.phoneNumber, Tipo: p.phoneNumber.length === 9 ? 2 : 1, Principal: 1 }],
  }
}

export function buildBankBody(p: SupplierProfile, codPes: number) {
  if (!p.bank) return null
  return {
    codigoPessoa: codPes,
    banco: p.bank.bankCode,
    agencia: p.bank.agency,
    nomeAgencia: p.bank.bankName ?? undefined,
    conta: p.bank.account,
    tipo: p.bank.accountType,
    padrao: true,
    debitoAutomatico: false,
  }
}

export interface AttachmentInput {
  fileName: string
  extension: string
  base64: string
}

const stripExtension = (name: string, ext: string) => (name.toLowerCase().endsWith(`.${ext.toLowerCase()}`) ? name.slice(0, -(ext.length + 1)) : name)

export function buildAttachBody(files: AttachmentInput[], opts: { codPes: number; folder: string; user: string; company: number }) {
  return {
    usuario: opts.user,
    // Sem empresa o UAU recusa (FK_HistoricoArquivoVinculado_Empresas)
    empresa: opts.company,
    lista_arquivos: files.map((f) => ({
      ConteudoArquivo: f.base64,
      // O UAU acrescenta a extensão: mandar sem ela (senão vira "x.pdf.pdf")
      NomeArquivo: stripExtension(f.fileName, f.extension),
      Extension: f.extension,
      CaminhoArquivo: opts.folder,
      Identificador: `Pessoas ${opts.codPes}`,
      Origem: 1,
    })),
  }
}

/** Pasta dos anexos: <pasta base>\<CNPJ>. */
/**
 * Pasta do fornecedor dentro da pasta de anexos de Suprimentos, no padrão que a Unità já usa:
 *   "<código da pessoa no UAU> - <NOME>"   (ex.: "5539 - PLUMA ICAMENTOS LTDA")
 * O nome sai sem acentos e sem caracteres que o Windows não aceita em pastas.
 */
export function supplierFolderName(codPes: number, name: string): string {
  const clean = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, 60)
    .trim()
  return clean ? `${codPes} - ${clean}` : String(codPes)
}

/** Acha a pasta já existente do fornecedor ("5539 - ..." ou "5539"), se houver. */
export function findSupplierFolder(existing: string[], codPes: number): string | null {
  return existing.find((n) => n.trim() === String(codPes) || n.trim().startsWith(`${codPes} - `) || n.trim().startsWith(`${codPes}-`)) ?? null
}

export const joinFolder = (base: string, folder: string) => `${base.replace(/[\\/]+$/, '')}\\${folder}`

/** Lê o código da pessoa devolvido pelo GravarPessoa (o formato varia entre versões do UAU). */
export function extractPersonCode(data: unknown): number | null {
  const seen = new Set<unknown>()
  const walk = (v: unknown): number | null => {
    if (v === null || v === undefined || seen.has(v)) return null
    if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim())
    if (typeof v !== 'object') return null
    seen.add(v)
    if (Array.isArray(v)) {
      for (const item of v) {
        const r = walk(item)
        if (r) return r
      }
      return null
    }
    const obj = v as Record<string, unknown>
    for (const key of Object.keys(obj)) {
      if (/^(cod_?pes|codigo_?pessoa|codpessoa|cod_pessoa)$/i.test(key)) {
        const r = walk(obj[key])
        if (r) return r
      }
    }
    for (const value of Object.values(obj)) {
      if (typeof value === 'object') {
        const r = walk(value)
        if (r) return r
      }
    }
    return null
  }
  return walk(data)
}
