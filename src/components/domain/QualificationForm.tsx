import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import type { QualificationDTO, RequestDetailDTO } from '@shared/contracts'
import { QUALIFICATION_ANSWER_LABELS, QUALIFICATION_ANSWERS, type QualificationAnswer } from '@shared/domain/qualification'
import { Alert, Badge, Button, EmptyState } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { cn } from '@/utils/cn'
import { formatDate } from '@/utils/format'

/**
 * Formulário de qualificação (equivalente ao QUALIFOR do UAU). Suprimentos responde na análise;
 * fora disso (ou para quem não analisa) mostra só as respostas.
 */
export function QualificationForm({
  requestId,
  qualification,
  editable,
  onSaved,
}: {
  requestId: string
  qualification: QualificationDTO
  editable: boolean
  onSaved?: (r: RequestDetailDTO) => void
}) {
  const saved = useMemo(() => Object.fromEntries(qualification.items.map((i) => [i.questionId, i.answer])), [qualification])
  const [draft, setDraft] = useState<Record<string, QualificationAnswer | null>>(saved)
  const changed = qualification.items.filter((i) => draft[i.questionId] && draft[i.questionId] !== saved[i.questionId])
  const save = useMutation({
    mutationFn: () =>
      api<RequestDetailDTO>(`/requests/${requestId}/qualification`, {
        method: 'PUT',
        body: { answers: changed.map((i) => ({ questionId: i.questionId, answer: draft[i.questionId] })) },
      }),
    onSuccess: (r) => onSaved?.(r),
  })

  if (!qualification.items.length) {
    return <EmptyState title="Sem perguntas" description="Cadastre as perguntas do formulário de qualificação no Painel dev." />
  }

  const answeredNow = qualification.items.filter((i) => draft[i.questionId]).length
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={qualification.complete ? 'success' : 'warning'}>
          {qualification.answered}/{qualification.total} respondidas
        </Badge>
        {qualification.uauAttachedAt && <Badge tone="info">PDF anexado no UAU em {formatDate(qualification.uauAttachedAt)}</Badge>}
        {editable && <span className="text-text-muted">Todas as perguntas precisam de resposta para enviar à aprovação.</span>}
      </div>

      <ol className="divide-y divide-border-soft rounded-card border border-border-soft">
        {qualification.items.map((item, idx) => {
          const options = QUALIFICATION_ANSWERS.filter((a) => a !== 'na' || item.allowNa)
          const value = draft[item.questionId]
          return (
            <li key={item.questionId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium">
                  {idx + 1}. {item.text}
                </p>
                {item.answeredByName && item.answeredAt && (
                  <p className="text-xs text-text-muted">
                    {item.answeredByName} · {formatDate(item.answeredAt)}
                  </p>
                )}
              </div>
              {editable ? (
                <div className="flex shrink-0 gap-1" role="radiogroup" aria-label={item.text}>
                  {options.map((a) => (
                    <button
                      key={a}
                      type="button"
                      role="radio"
                      aria-checked={value === a}
                      onClick={() => setDraft({ ...draft, [item.questionId]: a })}
                      className={cn(
                        'rounded-control border px-3 py-1.5 text-sm font-medium transition-colors',
                        value === a ? 'border-primary bg-primary-soft text-primary' : 'border-border text-ink-700 hover:bg-ink-50',
                      )}
                    >
                      {QUALIFICATION_ANSWER_LABELS[a]}
                    </button>
                  ))}
                </div>
              ) : (
                <Badge tone={item.answer === 'sim' ? 'success' : item.answer === 'nao' ? 'warning' : 'neutral'}>{item.answer ? QUALIFICATION_ANSWER_LABELS[item.answer] : 'Sem resposta'}</Badge>
              )}
            </li>
          )
        })}
      </ol>

      {editable && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
          <span className="text-xs text-text-muted">
            {answeredNow}/{qualification.total} marcadas
          </span>
          <Button variant="primary" icon={<Save className="size-4" />} disabled={!changed.length} loading={save.isPending} onClick={() => save.mutate()}>
            Salvar respostas
          </Button>
        </div>
      )}
    </div>
  )
}
