import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Star } from 'lucide-react'
import type { CriterionDTO, EvaluationDTO } from '@shared/contracts'
import { SCORE_LABELS, SCORE_MAX, weightedAverage } from '@shared/domain/evaluation'
import { Alert, Button, Dialog, Field, Input, Skeleton, Textarea } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { WorkSelect } from '@/components/domain/WorkSelect'
import { cn } from '@/utils/cn'
import { formatScore } from '@/utils/format'

/** Formulário de avaliação (notas de 1 a 10 por critério), usado na ficha e na tela "Avaliar". */
function Stars({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={label}>
      {Array.from({ length: SCORE_MAX }, (_, i) => i + 1).map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} — ${SCORE_LABELS[n]}`} onClick={() => onChange(n)} className="rounded p-0.5">
          <Star className={cn('size-6 transition', n <= value ? 'fill-primary text-primary' : 'text-ink-300 hover:text-primary')} />
        </button>
      ))}
      <span className="ml-2 w-16 text-xs text-text-muted">{value ? SCORE_LABELS[value] : ''}</span>
    </div>
  )
}

export function EvaluationDialog({ supplierId, supplierName, onClose, onSaved }: { supplierId: string; supplierName?: string; onClose: () => void; onSaved?: () => void }) {
  const qc = useQueryClient()
  const criteriaQ = useQuery({ queryKey: ['criteria'], queryFn: () => api<CriterionDTO[]>('/criteria') })
  const active = (criteriaQ.data ?? []).filter((c) => c.active)
  const [scores, setScores] = useState<Record<string, number>>({})
  const [workName, setWorkName] = useState('')
  const [reference, setReference] = useState('')
  const [comment, setComment] = useState('')
  const avg = weightedAverage(active, scores)
  const m = useMutation({
    mutationFn: () => api<EvaluationDTO>('/evaluations', { method: 'POST', body: { supplierId, workName, reference: reference || null, scores, comment: comment || null } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['supplier', supplierId] })
      void qc.invalidateQueries({ queryKey: ['suppliers'] })
      void qc.invalidateQueries({ queryKey: ['my-evaluations'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
      onSaved?.()
      onClose()
    },
  })
  const complete = active.length > 0 && active.every((c) => scores[c.id]) && workName.trim().length >= 2
  return (
    <Dialog
      open
      onClose={onClose}
      width="min(92vw, 36rem)"
      title={supplierName ? `Avaliar ${supplierName}` : 'Avaliar fornecimento'}
      description="Notas de 1 a 10 por critério; a média considera o peso de cada um."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className="mr-auto">
            Cancelar
          </Button>
          <Button variant="primary" disabled={!complete} loading={m.isPending} onClick={() => m.mutate()}>
            Salvar avaliação {avg !== null && `(${formatScore(avg)})`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Obra" required>
            <WorkSelect value={workName} onChange={setWorkName} />
          </Field>
          <Field label="Pedido / contrato">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
        {criteriaQ.isLoading && <Skeleton className="h-32" />}
        {criteriaQ.isError && <Alert tone="error">{errorMessage(criteriaQ.error)}</Alert>}
        <ul className="space-y-3">
          {active.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-text">
                  {c.name} <span className="text-xs text-text-muted">peso {c.weight}</span>
                </p>
                {c.description && <p className="text-xs text-text-muted">{c.description}</p>}
              </div>
              <Stars value={scores[c.id] ?? 0} onChange={(v) => setScores((s) => ({ ...s, [c.id]: v }))} label={c.name} />
            </li>
          ))}
        </ul>
        <Field label="Comentário">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
        </Field>
        {m.isError && <Alert tone="error">{errorMessage(m.error)}</Alert>}
      </div>
    </Dialog>
  )
}

