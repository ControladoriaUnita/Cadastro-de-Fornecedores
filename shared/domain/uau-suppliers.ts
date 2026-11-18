/**
 * Pessoa do UAU (Pessoas/ConsultarPessoasPorCondicao) → fornecedor do app. Funções puras.
 *
 * O UAU não marca quem é fornecedor (não há campo nem rota de categoria e subconsultas
 * são recusadas). Regra (mesma do Quadro de Concorrência): fornecedor = pessoa JURÍDICA
 * (CNPJ de 14 dígitos) ATIVA (AtivoInativo = 0). Pessoas físicas ficam de fora: em boa
 * parte são clientes que compram unidades (dado pessoal, LGPD).
 * A resposta traz SenhaLoginPessoa e outros campos sensíveis: só os campos abaixo são lidos.
 */

type Row = Record<string, unknown>

export interface UauSupplier {
  codPes: number
  document: string
  legalName: string
  tradeName: string | null
  email: string | null
}

export type UauSkipReason = 'pessoa_fisica' | 'inativa' | 'invalida'

/** Quantas pessoas cada consulta lê (faixa de cod_pes). 500 ≈ 1,5 s no UAU. */
export const UAU_SYNC_RANGE = 500
/** Fim do cadastro: tantos códigos seguidos sem ninguém (tolera buracos menores). */
export const UAU_SYNC_STOP_AFTER_EMPTY = 4000
/** Teto de segurança, caso a parada por faixas vazias falhe. */
export const UAU_SYNC_MAX_CODE = 200_000

const text = (v: unknown): string | null => {
  if (v == null) return null
  const s = String(v).replace(/\s+/g, ' ').trim()
  return s || null
}

const EMAIL = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/

/** Primeiro e-mail válido do campo (o UAU às vezes traz vários separados por ; ou ,). */
export function firstValidEmail(v: unknown): string | null {
  for (const part of String(v ?? '').split(/[;,\s]+/)) {
    const e = part.trim().toLowerCase()
    if (EMAIL.test(e)) return e
  }
  return null
}

export function mapUauPerson(row: Row): UauSupplier | UauSkipReason {
  if (Number(row.TipoPessoa) !== 1) return 'pessoa_fisica'
  const document = String(row.CpfPessoa ?? '').replace(/\D/g, '')
  if (document.length !== 14) return 'invalida'
  if (Number(row.AtivoInativo) !== 0) return 'inativa'
  const legalName = text(row.NomePessoa)
  const codPes = Number(row.CodigoPessoa)
  if (!legalName || !Number.isInteger(codPes) || codPes <= 0) return 'invalida'
  return { codPes, document, legalName, tradeName: text(row.NomeFantasia), email: firstValidEmail(row.EmailPessoa) }
}

export interface UauSupplierBatch {
  suppliers: UauSupplier[]
  skipped: Record<UauSkipReason | 'duplicada', number>
}

/**
 * Filtra, mapeia e tira CNPJs repetidos (o cadastro do UAU tem alguns).
 * Fica o de maior código de pessoa, o mais recente. O banco aplica a mesma regra entre lotes.
 */
export function selectUauSuppliers(rows: Row[]): UauSupplierBatch {
  const skipped = { pessoa_fisica: 0, inativa: 0, invalida: 0, duplicada: 0 }
  const best = new Map<string, UauSupplier>()
  for (const row of rows) {
    const s = mapUauPerson(row)
    if (typeof s === 'string') {
      skipped[s]++
      continue
    }
    const cur = best.get(s.document)
    if (cur) {
      skipped.duplicada++
      if (cur.codPes >= s.codPes) continue
    }
    best.set(s.document, s)
  }
  return { suppliers: [...best.values()], skipped }
}
