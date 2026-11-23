/**
 * Formulário de qualificação do fornecedor (equivalente ao questionário QUALIFOR do UAU).
 * Respondido por Suprimentos na análise; todas as perguntas ativas precisam de resposta
 * antes de enviar para aprovação. As respostas vão ao UAU como PDF anexado ao fornecedor.
 */
export const QUALIFICATION_ANSWERS = ['nao', 'sim', 'na'] as const
export type QualificationAnswer = (typeof QUALIFICATION_ANSWERS)[number]

export const QUALIFICATION_ANSWER_LABELS: Record<QualificationAnswer, string> = { nao: 'Não', sim: 'Sim', na: 'Não se aplica' }

export interface QualificationItem {
  questionId: string
  text: string
  allowNa: boolean
  answer: QualificationAnswer | null
}

/** Perguntas ativas sem resposta (ou com "Não se aplica" onde a opção não existe). */
export function unansweredQuestions(items: QualificationItem[]): QualificationItem[] {
  return items.filter((i) => !i.answer || (i.answer === 'na' && !i.allowNa))
}
