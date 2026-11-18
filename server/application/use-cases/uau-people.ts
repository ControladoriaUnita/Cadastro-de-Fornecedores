/**
 * Consultas de pessoa no UAU (somente leitura).
 * O UAU devolve os campos com nomes diferentes conforme a rota (cod_pes / CodigoPessoa),
 * então os leitores aqui aceitam as duas formas. Campos de senha nunca são lidos.
 */
import { UAU_ROUTES } from '../../../shared/domain/uau-payload'
import { extractRows } from '../../infrastructure/uau/uau-client'
import type { UauGateway } from '../ports'

const pick = (row: Record<string, unknown>, ...names: string[]) => {
  const key = Object.keys(row).find((k) => names.some((n) => n.toLowerCase() === k.toLowerCase()))
  return key ? row[key] : undefined
}

export interface UauPerson {
  codPes: number
  name: string | null
  tradeName: string | null
  email: string | null
  active: boolean | null
}

function toPerson(row: Record<string, unknown>): UauPerson | null {
  const cod = Number(pick(row, 'cod_pes', 'CodigoPessoa', 'codigo_pessoa'))
  if (!Number.isInteger(cod) || cod <= 0) return null
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const atinat = pick(row, 'atinat_pes', 'AtivoInativo')
  return {
    codPes: cod,
    name: str(pick(row, 'nome_pes', 'NomePessoa')),
    tradeName: str(pick(row, 'nomefant_pes', 'NomeFantasia')),
    email: str(pick(row, 'email_pes', 'EmailPessoa'))?.toLowerCase() ?? null,
    active: atinat === undefined || atinat === null ? null : Number(atinat) === 0,
  }
}

/** Procura a pessoa pelo CPF/CNPJ (ativos e inativos). */
export async function findUauPerson(uau: UauGateway, document: string): Promise<UauPerson | null> {
  const res = await uau.call(UAU_ROUTES.findByDocument, { cpf_cnpj: document, status: 2 })
  // "Não foi encontrado nenhuma pessoa com os dados informados." vem como HTTP 400
  if (res.status === 404 || (res.status === 400 && /n[ãa]o (foi )?encontrad/i.test(JSON.stringify(res.data)))) return null
  if (!res.ok) throw new Error(`UAU respondeu HTTP ${res.status} na consulta por CPF/CNPJ.`)
  const rows = extractRows(res.data)
  const direct = res.data && typeof res.data === 'object' && !Array.isArray(res.data) ? [res.data as Record<string, unknown>] : []
  for (const row of [...rows, ...direct]) {
    const p = toPerson(row)
    if (p) return p
  }
  return null
}

/** Versão que nunca lança: para telas que só mostram "existe / não existe / não consegui ver". */
export async function checkUauPerson(uau: UauGateway, document: string) {
  try {
    const p = await findUauPerson(uau, document)
    return { found: !!p, codPes: p?.codPes ?? null, name: p?.name ?? null, error: null }
  } catch (err) {
    return { found: false, codPes: null, name: null, error: err instanceof Error ? err.message : 'Falha ao consultar o UAU.' }
  }
}
