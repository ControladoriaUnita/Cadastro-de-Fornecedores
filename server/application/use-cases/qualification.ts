/**
 * Formulário de qualificação (equivalente ao QUALIFOR do UAU): perguntas editáveis no Painel dev,
 * respondidas por Suprimentos na análise. Todas as ativas precisam de resposta para enviar à
 * aprovação; na gravação, as respostas vão ao UAU como PDF anexado ao fornecedor.
 */
import { asc, eq } from 'drizzle-orm'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import type { z } from 'zod'
import type { QualificationDTO, QualificationQuestionDTO, qualificationAnswersSchema, qualificationQuestionSchema } from '../../../shared/contracts'
import { formatDocument } from '../../../shared/domain/document-number'
import { QUALIFICATION_ANSWER_LABELS, type QualificationAnswer, unansweredQuestions } from '../../../shared/domain/qualification'
import type { RequestStatus } from '../../../shared/domain/request/status'
import { PERMISSIONS } from '../../../shared/domain/roles'
import type { Db } from '../../infrastructure/db/client'
import { schema } from '../../infrastructure/db/client'
import { AppError, notFound, requirePermission } from '../context'
import type { UseCaseDeps } from '../ports'
import { recordEvent } from '../shared'

const { qualificationAnswers, qualificationQuestions, requests, users } = schema

/** Etapas em que Suprimentos ainda pode responder/alterar o formulário. */
const EDITABLE: RequestStatus[] = ['solicitado', 'aguardando_fornecedor', 'em_analise', 'pendencias']

// ----------------------------------------------------------------------------- perguntas (Painel dev)

export async function listQualificationQuestions(deps: UseCaseDeps): Promise<QualificationQuestionDTO[]> {
  requirePermission(deps.ctx.actor, PERMISSIONS.settingsManage, PERMISSIONS.requestAnalyze)
  return deps.db.select().from(qualificationQuestions).orderBy(asc(qualificationQuestions.sort), asc(qualificationQuestions.createdAt))
}

export async function saveQualificationQuestion(deps: UseCaseDeps, id: string | null, input: z.infer<typeof qualificationQuestionSchema>) {
  requirePermission(deps.ctx.actor, PERMISSIONS.settingsManage)
  if (!id) return (await deps.db.insert(qualificationQuestions).values(input).returning())[0]
  const [row] = await deps.db.update(qualificationQuestions).set(input).where(eq(qualificationQuestions.id, id)).returning()
  if (!row) throw notFound('Pergunta')
  return row
}

// ----------------------------------------------------------------------------- respostas da solicitação

/**
 * Perguntas ativas + respostas da solicitação. Uma pergunta desativada depois de respondida
 * continua aparecendo (com a resposta), para o registro não mudar.
 */
export async function loadQualification(db: Db, request: { id: string; qualificationUauAt: Date | null }): Promise<QualificationDTO> {
  const [questions, answers] = await Promise.all([
    db.select().from(qualificationQuestions).orderBy(asc(qualificationQuestions.sort), asc(qualificationQuestions.createdAt)),
    db
      .select({ a: qualificationAnswers, by: users.fullName })
      .from(qualificationAnswers)
      .leftJoin(users, eq(users.id, qualificationAnswers.answeredBy))
      .where(eq(qualificationAnswers.requestId, request.id)),
  ])
  const byQuestion = new Map(answers.map((x) => [x.a.questionId, x]))
  const items = questions
    .filter((q) => q.active || byQuestion.has(q.id))
    .map((q) => {
      const found = byQuestion.get(q.id)
      return {
        questionId: q.id,
        text: found?.a.questionText ?? q.text,
        allowNa: q.allowNa,
        answer: (found?.a.answer as QualificationAnswer | undefined) ?? null,
        answeredByName: found?.by ?? null,
        answeredAt: found?.a.answeredAt.toISOString() ?? null,
      }
    })
  const pending = unansweredQuestions(items)
  return {
    items,
    answered: items.length - pending.length,
    total: items.length,
    complete: items.length > 0 && pending.length === 0,
    uauAttachedAt: request.qualificationUauAt?.toISOString() ?? null,
  }
}

export async function saveQualification(deps: UseCaseDeps, requestId: string, input: z.infer<typeof qualificationAnswersSchema>) {
  requirePermission(deps.ctx.actor, PERMISSIONS.requestAnalyze)
  const [r] = await deps.db.select().from(requests).where(eq(requests.id, requestId))
  if (!r) throw notFound('Solicitação')
  if (!EDITABLE.includes(r.status as RequestStatus)) throw new AppError('QUALIFICATION_LOCKED', 'O formulário só pode ser alterado durante a análise.', 409)

  const questions = new Map((await deps.db.select().from(qualificationQuestions)).map((q) => [q.id, q]))
  const now = deps.ctx.now()
  for (const { questionId, answer } of input.answers) {
    const q = questions.get(questionId)
    if (!q) throw notFound('Pergunta')
    if (answer === 'na' && !q.allowNa) throw new AppError('INVALID_ANSWER', `"${q.text}" não aceita "Não se aplica".`, 422)
    await deps.db
      .insert(qualificationAnswers)
      .values({ requestId, questionId, questionText: q.text, answer, answeredBy: deps.ctx.actor.id, answeredAt: now })
      .onConflictDoUpdate({
        target: [qualificationAnswers.requestId, qualificationAnswers.questionId],
        set: { answer, questionText: q.text, answeredBy: deps.ctx.actor.id, answeredAt: now },
      })
  }
  const q = await loadQualification(deps.db, r)
  await recordEvent(deps.db, {
    requestId,
    actorId: deps.ctx.actor.id,
    actorLabel: deps.ctx.actor.fullName,
    kind: 'qualification',
    comment: `Formulário de qualificação: ${q.answered} de ${q.total} respondidas.`,
  })
}

// ----------------------------------------------------------------------------- PDF para o UAU

/** Helvetica do PDF só tem o alfabeto latino (WinAnsi): troca o que ela não desenha. */
const pdfSafe = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E -ÿ–—]/g, '?')

function wrap(text: string, max: number, measure: (s: string) => number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (measure(next) > max && line) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

/** "Formulário de qualificação" em PDF (A4), anexado no UAU junto com os documentos. */
export async function qualificationPdf(p: {
  number: number
  supplierName: string
  document: string
  codPes: number | null
  qualification: QualificationDTO
  generatedAt: Date
}): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const orange = rgb(254 / 255, 80 / 255, 0)
  const ink = rgb(35 / 255, 31 / 255, 32 / 255)
  const muted = rgb(0.4, 0.4, 0.4)
  const [W, H, M] = [595.28, 841.89, 48]
  let page = pdf.addPage([W, H])
  let y = H - M

  const text = (s: string, x: number, size: number, f = font, color = ink) => page.drawText(pdfSafe(s), { x, y, size, font: f, color })
  const ensure = (h: number) => {
    if (y - h < M) {
      page = pdf.addPage([W, H])
      y = H - M
    }
  }

  text('Unità Engenharia', M, 10, bold, orange)
  y -= 22
  text('Formulário de qualificação de prestadores e fornecedores', M, 15, bold)
  y -= 20
  text(`${p.supplierName} · ${formatDocument(p.document)}${p.codPes ? ` · Pessoa ${p.codPes} no UAU` : ''}`, M, 10, font, muted)
  y -= 14
  text(`Solicitação nº ${p.number} · gerado em ${p.generatedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, M, 10, font, muted)
  y -= 16
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: orange })
  y -= 22

  const answerX = W - M - 90
  p.qualification.items.forEach((item, i) => {
    const lines = wrap(pdfSafe(`${i + 1}. ${item.text}`), answerX - M - 12, (s) => font.widthOfTextAtSize(s, 11))
    ensure(lines.length * 15 + 26)
    const top = y
    for (const l of lines) {
      text(l, M, 11)
      y -= 15
    }
    const label = item.answer ? QUALIFICATION_ANSWER_LABELS[item.answer] : '—'
    page.drawText(pdfSafe(label), { x: answerX, y: top, size: 11, font: bold, color: item.answer === 'nao' ? orange : ink })
    if (item.answeredByName && item.answeredAt) {
      text(`Respondido por ${item.answeredByName} em ${new Date(item.answeredAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, M, 8, font, muted)
      y -= 12
    }
    y -= 10
  })
  return Buffer.from(await pdf.save())
}
