/**
 * Dados públicos da Receita Federal pelo CNPJ.
 *   1º BrasilAPI (gratuita, sem chave) · 2º CNPJ.ws pública (gratuita, 3 consultas/min) como reserva.
 * Também consulta CEP (BrasilAPI) para preencher endereço no portal do fornecedor.
 */
import { IntegrationError } from '../../application/context'
import type { CompanyData, CompanyLookup } from '../../application/ports'

const TIMEOUT_MS = 15_000
const UA = { 'User-Agent': 'fornecedores-app/1.0', Accept: 'application/json' }

type Json = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() && !isNaN(Number(v)) ? Number(v) : null)
const bool = (v: unknown) => (typeof v === 'boolean' ? v : null)
const cnaeCode = (v: unknown) => String(v ?? '').replace(/\D/g, '').padStart(7, '0')

async function getJson(url: string): Promise<{ status: number; data: Json | null }> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(TIMEOUT_MS) })
  const data = (await res.json().catch(() => null)) as Json | null
  return { status: res.status, data }
}

function fromBrasilApi(d: Json): CompanyData {
  const secundarios = Array.isArray(d.cnaes_secundarios) ? (d.cnaes_secundarios as Json[]) : []
  const qsa = Array.isArray(d.qsa) ? (d.qsa as Json[]) : []
  const tipoLogr = str(d.descricao_tipo_de_logradouro)
  const logr = str(d.logradouro)
  return {
    cnpj: String(d.cnpj ?? ''),
    razaoSocial: str(d.razao_social) ?? '',
    nomeFantasia: str(d.nome_fantasia),
    situacaoCadastral: str(d.descricao_situacao_cadastral),
    dataSituacao: str(d.data_situacao_cadastral),
    dataAbertura: str(d.data_inicio_atividade),
    naturezaJuridica: str(d.natureza_juridica),
    porte: str(d.porte),
    capitalSocial: num(d.capital_social),
    cnaePrincipal: d.cnae_fiscal ? { codigo: cnaeCode(d.cnae_fiscal), descricao: str(d.cnae_fiscal_descricao) ?? '' } : null,
    cnaesSecundarios: secundarios.filter((c) => Number(c.codigo)).map((c) => ({ codigo: cnaeCode(c.codigo), descricao: str(c.descricao) ?? '' })),
    simples: bool(d.opcao_pelo_simples),
    mei: bool(d.opcao_pelo_mei),
    email: str(d.email)?.toLowerCase() ?? null,
    telefone: str(d.ddd_telefone_1),
    endereco: {
      cep: str(d.cep)?.replace(/\D/g, '') ?? null,
      logradouro: logr ? (tipoLogr && !logr.toUpperCase().startsWith(tipoLogr.toUpperCase()) ? `${tipoLogr} ${logr}` : logr) : null,
      numero: str(d.numero),
      complemento: str(d.complemento),
      bairro: str(d.bairro),
      municipio: str(d.municipio),
      uf: str(d.uf),
    },
    socios: qsa.map((s) => ({ nome: str(s.nome_socio) ?? '', qualificacao: str(s.qualificacao_socio) })).filter((s) => s.nome),
    fonte: 'Receita Federal (BrasilAPI)',
  }
}

function fromCnpjWs(d: Json): CompanyData {
  const e = (d.estabelecimento ?? {}) as Json
  const ativ = (e.atividade_principal ?? null) as Json | null
  const sec = Array.isArray(e.atividades_secundarias) ? (e.atividades_secundarias as Json[]) : []
  const simples = (d.simples ?? null) as Json | null
  const cidade = (e.cidade ?? {}) as Json
  const estado = (e.estado ?? {}) as Json
  return {
    cnpj: str(e.cnpj) ?? '',
    razaoSocial: str(d.razao_social) ?? '',
    nomeFantasia: str(e.nome_fantasia),
    situacaoCadastral: str(e.situacao_cadastral),
    dataSituacao: str(e.data_situacao_cadastral),
    dataAbertura: str(e.data_inicio_atividade),
    naturezaJuridica: str((d.natureza_juridica as Json | undefined)?.descricao),
    porte: str((d.porte as Json | undefined)?.descricao),
    capitalSocial: num(d.capital_social),
    cnaePrincipal: ativ ? { codigo: cnaeCode(ativ.subclasse ?? ativ.id), descricao: str(ativ.descricao) ?? '' } : null,
    cnaesSecundarios: sec.map((c) => ({ codigo: cnaeCode(c.subclasse ?? c.id), descricao: str(c.descricao) ?? '' })),
    simples: simples ? str(simples.simples) === 'Sim' : null,
    mei: simples ? str(simples.mei) === 'Sim' : null,
    email: str(e.email)?.toLowerCase() ?? null,
    telefone: e.ddd1 && e.telefone1 ? `${e.ddd1}${e.telefone1}` : null,
    endereco: {
      cep: str(e.cep),
      logradouro: [str(e.tipo_logradouro), str(e.logradouro)].filter(Boolean).join(' ') || null,
      numero: str(e.numero),
      complemento: str(e.complemento),
      bairro: str(e.bairro),
      municipio: str(cidade.nome),
      uf: str(estado.sigla),
    },
    socios: (Array.isArray(d.socios) ? (d.socios as Json[]) : []).map((s) => ({
      nome: str(s.nome) ?? '',
      qualificacao: str((s.qualificacao_socio as Json | undefined)?.descricao),
    })),
    fonte: 'Receita Federal (CNPJ.ws)',
  }
}

export class PublicCompanyLookup implements CompanyLookup {
  async find(cnpj: string): Promise<CompanyData | null> {
    let firstError: unknown = null
    try {
      const r = await getJson(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`)
      if (r.status === 200 && r.data) return fromBrasilApi(r.data)
      if (r.status === 404) return null
      firstError = new Error(`BrasilAPI HTTP ${r.status}`)
    } catch (err) {
      firstError = err
    }
    try {
      const r = await getJson(`https://publica.cnpj.ws/cnpj/${cnpj}`)
      if (r.status === 200 && r.data) return fromCnpjWs(r.data)
      if (r.status === 404 || r.status === 400) return null
      throw new Error(`CNPJ.ws HTTP ${r.status}`)
    } catch (err) {
      console.warn('[cnpj] consultas falharam', firstError, err)
      throw new IntegrationError('As bases públicas de CNPJ não responderam agora. Tente de novo em instantes.')
    }
  }
}

export interface CepData {
  cep: string
  street: string | null
  district: string | null
  city: string | null
  uf: string | null
}

export async function findCep(cep: string): Promise<CepData | null> {
  try {
    const r = await getJson(`https://brasilapi.com.br/api/cep/v2/${cep}`)
    if (r.status !== 200 || !r.data) return null
    return { cep, street: str(r.data.street), district: str(r.data.neighborhood), city: str(r.data.city), uf: str(r.data.state) }
  } catch {
    return null
  }
}
