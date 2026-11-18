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
