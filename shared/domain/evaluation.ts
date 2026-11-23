/**
 * Avaliação de fornecedor: notas de 1 a 5 por critério, média ponderada pelos pesos.
 */

export const SCORE_MIN = 1
export const SCORE_MAX = 5

export const SCORE_LABELS: Record<number, string> = { 1: 'Péssimo', 2: 'Ruim', 3: 'Regular', 4: 'Bom', 5: 'Ótimo' }

export interface CriterionLike {
  id: string
  weight: number
}

/** Média ponderada só dos critérios com nota. null quando não há nota. */
export function weightedAverage(criteria: CriterionLike[], scores: Record<string, number>): number | null {
  let sum = 0
  let weights = 0
  for (const c of criteria) {
    const s = scores[c.id]
    if (s === undefined) continue
    sum += s * c.weight
    weights += c.weight
  }
  return weights ? Math.round((sum / weights) * 100) / 100 : null
}

export type ScoreBand = 'otimo' | 'bom' | 'atencao' | 'critico'

export function scoreBand(avg: number | null): ScoreBand | null {
  if (avg === null) return null
  if (avg >= 4.5) return 'otimo'
  if (avg >= 3.5) return 'bom'
  if (avg >= 2.5) return 'atencao'
  return 'critico'
}

export const BAND_LABELS: Record<ScoreBand, string> = { otimo: 'Ótimo', bom: 'Bom', atencao: 'Atenção', critico: 'Crítico' }

// ----------------------------------------------------------------------------- médias mensal e geral

/** Mês no horário de Brasília, no formato "2026-11". */
export function monthKey(d: Date | string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date(d))
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
/** "2026-11" → "nov/2026" */
export const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]}/${key.slice(0, 4)}`

const round2 = (n: number) => Math.round(n * 100) / 100
const mean = (xs: number[]) => (xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null)

export interface MonthScore {
  month: string
  average: number | null
  count: number
}

export interface SupplierScores {
  /** Média de todas as avaliações */
  overall: number | null
  overallCount: number
  /** Média das avaliações do mês corrente (Brasília) */
  month: number | null
  monthCount: number
  /** Últimos 12 meses, do mais recente para o mais antigo (meses sem avaliação vêm com null) */
  monthly: MonthScore[]
}

/** Indicadores de avaliação de um fornecedor: média geral, média do mês e histórico mensal. */
export function supplierScores(evals: { average: number | null; createdAt: Date | string }[], now: Date, months = 12): SupplierScores {
  const valid = evals.filter((e): e is { average: number; createdAt: Date | string } => e.average !== null)
  const byMonth = new Map<string, number[]>()
  for (const e of valid) {
    const k = monthKey(e.createdAt)
    byMonth.set(k, [...(byMonth.get(k) ?? []), e.average])
  }
  const current = monthKey(now)
  const monthly: MonthScore[] = []
  const [y, m] = current.split('-').map(Number) as [number, number]
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 15))
    const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    const xs = byMonth.get(k) ?? []
    monthly.push({ month: k, average: mean(xs), count: xs.length })
  }
  const cur = byMonth.get(current) ?? []
  return { overall: mean(valid.map((e) => e.average)), overallCount: valid.length, month: mean(cur), monthCount: cur.length, monthly }
}
