import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Star } from 'lucide-react'
import type { CriterionDTO, EvaluationDTO, ModelDTO, SupplierFullDTO } from '@shared/contracts'
import { SCORE_LABELS, weightedAverage } from '@shared/domain/evaluation'
import { PERMISSIONS } from '@shared/domain/roles'
import { SUPPLIER_STATUS_LABELS, SUPPLIER_STATUSES, type SupplierStatus } from '@shared/domain/supplier'
import { PATHS } from '@/app/navigation'
import { CompanyCard } from '@/components/domain/CompanyCard'
import { DocumentList } from '@/components/domain/DocumentList'
import { ProfileView } from '@/components/domain/ProfileView'
import { RequestStatusBadge, RiskBadge, SupplierStatusBadge } from '@/components/domain/badges'
import { RiskPanel } from '@/components/domain/RiskPanel'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, EmptyState, Field, Input, Kpi, Select, Skeleton, Tabs, Textarea } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatDate, formatDocument, formatScore } from '@/utils/format'
import { cn } from '@/utils/cn'

type Tab = 'profile' | 'docs' | 'risk' | 'evaluations' | 'requests' | 'company'

function Stars({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} — ${SCORE_LABELS[n]}`} onClick={() => onChange(n)} className="rounded p-0.5">
          <Star className={cn('size-6 transition', n <= value ? 'fill-primary text-primary' : 'text-ink-300 hover:text-primary')} />
        </button>
      ))}
      <span className="ml-2 w-16 text-xs text-text-muted">{value ? SCORE_LABELS[value] : ''}</span>
    </div>
  )
}

function EvaluationDialog({ supplierId, criteria, onClose }: { supplierId: string; criteria: CriterionDTO[]; onClose: () => void }) {
  const qc = useQueryClient()
  const active = criteria.filter((c) => c.active)
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
      onClose()
    },
  })
  const complete = active.every((c) => scores[c.id]) && workName.trim().length >= 2
  return (
    <Dialog
      open
      onClose={onClose}
      width="min(92vw, 36rem)"
      title="Avaliar fornecimento"
      description="Notas de 1 a 5 por critério; a média considera o peso de cada um."
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
            <Input value={workName} onChange={(e) => setWorkName(e.target.value)} />
          </Field>
          <Field label="Pedido / contrato">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
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

export default function SupplierPage() {
  const { id = '' } = useParams()
  const { can } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('profile')
  const [evaluating, setEvaluating] = useState(false)
  const q = useQuery({ queryKey: ['supplier', id], queryFn: () => api<SupplierFullDTO>(`/suppliers/${id}`) })
  const models = useQuery({ queryKey: ['models'], queryFn: () => api<ModelDTO[]>('/models') })
  const set = (r: SupplierFullDTO) => {
    qc.setQueryData(['supplier', id], r)
    void qc.invalidateQueries({ queryKey: ['suppliers'] })
  }
  const risk = useMutation({ mutationFn: () => api<SupplierFullDTO>(`/suppliers/${id}/risk`, { method: 'POST' }), onSuccess: set })
  const update = useMutation({ mutationFn: (body: { status?: SupplierStatus; modelId?: string | null }) => api<SupplierFullDTO>(`/suppliers/${id}`, { method: 'PATCH', body }), onSuccess: set })

  if (q.isLoading) return <Skeleton className="h-96" />
  if (q.isError || !q.data) return <Alert tone="error">{errorMessage(q.error)}</Alert>
  const { supplier: s, documents, riskChecks, evaluations, criteria, average, requests } = q.data
  const model = models.data?.find((m) => m.id === s.modelId)
  const manage = can(PERMISSIONS.supplierManage)
  const criterionName = new Map(criteria.map((c) => [c.id, c.name]))

  return (
    <>
      <PageHeader
        eyebrow="Fornecedores"
        backTo={PATHS.suppliers}
        title={s.tradeName || s.legalName}
        meta={
          <>
            <SupplierStatusBadge status={s.status} />
            <RiskBadge level={s.riskLevel} compact />
            {s.source === 'uau' && <Badge tone="info">Importado do UAU</Badge>}
          </>
        }
        description={`${s.legalName} · ${formatDocument(s.document)}`}
        actions={
          can(PERMISSIONS.evaluationCreate) && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEvaluating(true)}>
              Avaliar
            </Button>
          )
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Avaliação média" value={average === null ? '—' : formatScore(average)} hint={`${evaluations.length} avaliação(ões)`} />
        <Kpi label="Código no UAU" value={s.uauCodPes ?? '—'} hint={s.uauSyncedAt ? `Sincronizado ${formatDate(s.uauSyncedAt)}` : 'Não gravado'} />
        <Kpi label="Documentos vencidos" value={documents.filter((d) => d.expiry === 'vencido').length} tone={documents.some((d) => d.expiry === 'vencido') ? 'error' : undefined} hint={`${documents.filter((d) => d.expiry === 'vencendo').length} vencendo`} />
        <Kpi label="Última análise de risco" value={s.riskCheckedAt ? formatDate(s.riskCheckedAt) : '—'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Card>
          <div className="px-4 pt-2">
            <Tabs<Tab>
              value={tab}
              onChange={setTab}
              items={[
                { key: 'profile', label: 'Ficha' },
                { key: 'docs', label: 'Documentos', count: documents.length },
                { key: 'risk', label: 'Risco' },
                { key: 'evaluations', label: 'Avaliações', count: evaluations.length },
                { key: 'requests', label: 'Solicitações', count: requests.length },
                ...(s.receita ? [{ key: 'company' as Tab, label: 'Receita Federal' }] : []),
              ]}
            />
          </div>
          <CardBody className="py-5">
            {tab === 'profile' && <ProfileView profile={s.profile} />}
            {tab === 'docs' &&
              (model ? (
                <DocumentList requirements={model.requirements} documents={documents} fileUrl={(d) => `/api/documents/${d.id}/file`} extraDocuments />
              ) : (
                <DocumentList requirements={[]} documents={documents} fileUrl={(d) => `/api/documents/${d.id}/file`} extraDocuments />
              ))}
            {tab === 'risk' && (
              <>
                {risk.isError && <Alert tone="error" className="mb-4">{errorMessage(risk.error)}</Alert>}
                <RiskPanel check={riskChecks[0] ?? null} onRun={manage ? () => risk.mutate() : undefined} running={risk.isPending} />
              </>
            )}
            {tab === 'evaluations' &&
              (evaluations.length ? (
                <ul className="divide-y divide-border-soft">
                  {evaluations.map((e) => (
                    <li key={e.id} className="py-4 first:pt-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">
                          {e.workName}
                          {e.reference && <span className="text-text-muted"> · {e.reference}</span>}
                        </p>
                        <span className="inline-flex items-center gap-1 font-semibold">
                          <Star className="size-4 fill-primary text-primary" /> {formatScore(e.average)}
                        </span>
                      </div>
                      <p className="text-xs text-text-muted">
                        {e.evaluatorName} · {formatDate(e.createdAt)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {Object.entries(e.scores).map(([cid, v]) => (
                          <span key={cid} className="rounded-full bg-ink-100 px-2.5 py-0.5 text-xs text-ink-700">
                            {criterionName.get(cid) ?? 'Critério'}: <b>{v}</b>
                          </span>
                        ))}
                      </div>
                      {e.comment && <p className="mt-2 text-sm text-ink-700">{e.comment}</p>}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="Sem avaliações" description="Avalie ao fim de cada fornecimento: prazo, qualidade, segurança…" />
              ))}
            {tab === 'requests' && (
              <ul className="divide-y divide-border-soft">
                {requests.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-3">
                    <Link to={PATHS.request(r.id)} className="font-medium hover:text-primary">
                      nº {r.number} · {formatDate(r.createdAt)}
                    </Link>
                    <RequestStatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            )}
            {tab === 'company' && s.receita && <CompanyCard company={s.receita} />}
          </CardBody>
        </Card>

        {manage && (
          <Card className="h-fit">
            <CardHeader title="Gestão" />
            <CardBody className="space-y-4">
              <Field label="Situação no app">
                <Select value={s.status} onChange={(e) => update.mutate({ status: e.target.value as SupplierStatus })}>
                  {SUPPLIER_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {SUPPLIER_STATUS_LABELS[st]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Modelo" hint="Define os documentos exigidos e o CNAE esperado.">
                <Select value={s.modelId ?? ''} onChange={(e) => update.mutate({ modelId: e.target.value || null })}>
                  <option value="">Sem modelo</option>
                  {models.data?.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {update.isError && <Alert tone="error">{errorMessage(update.error)}</Alert>}
              <Link to={`${PATHS.newRequest}`} className="block text-sm font-medium text-primary hover:underline">
                Abrir nova solicitação (renovar documentos)
              </Link>
            </CardBody>
          </Card>
        )}
      </div>
      {evaluating && <EvaluationDialog supplierId={s.id} criteria={criteria} onClose={() => setEvaluating(false)} />}
    </>
  )
}
