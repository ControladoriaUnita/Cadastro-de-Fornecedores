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
import type { SupplierProfile } from './supplier'

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

export function buildSavePersonBody(p: SupplierProfile, opts: { user: string; now: Date }) {
  const pj = p.document.length === 14
  const address = {
    CodPes_pend: 0,
    Tipo_pend: 0, // endereço principal
    Endereco_pend: cut(p.address.street, 120),
    NumEnd_pend: cut(p.address.number, 10),
    ComplEndereco_pend: cut(p.address.complement, 60),
    Bairro_pend: cut(p.address.district, 60),
    Cidade_pend: cut(p.address.city, 60),
    UF_pend: p.address.uf,
    CEP_pend: p.address.cep,
  }
  return {
    nao_validar_campos_obrigatorios: false,
    info_pes: [
      {
        cod_pes: 0,
        nome_pes: p.legalName.toUpperCase().slice(0, 100),
        tipo_pes: pj ? 1 : 0,
        cpf_pes: onlyDigits(p.document),
        dtcad_pes: opts.now.toISOString(),
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
    ],
    ...(pj
      ? { infopes_jur: [{ cod_pj: 0, contato_pj: p.contactName ?? undefined, optantesimples_pj: p.simplesNacional ?? undefined }] }
      : { info_pesfis: [{ cod_pf: 0 }] }),
    info_pesendereco_principal: [address],
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

export function buildAttachBody(files: AttachmentInput[], opts: { codPes: number; folder: string; user: string }) {
  return {
    usuario: opts.user,
    lista_arquivos: files.map((f) => ({
      ConteudoArquivo: f.base64,
      NomeArquivo: f.fileName,
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
