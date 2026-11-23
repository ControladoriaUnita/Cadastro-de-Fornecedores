import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CircleAlert, ExternalLink, Mail, ShieldCheck, X } from 'lucide-react'
import type { DocumentDTO, ModelDTO, RequestDetailDTO } from '@shared/contracts'
import { personKindOf } from '@shared/domain/document-number'
import { STATUS_DESCRIPTIONS } from '@shared/domain/request/status'
import { ACTIONS, type RequestAction } from '@shared/domain/request/workflow'
import { PERMISSIONS } from '@shared/domain/roles'
import { PATHS } from '@/app/navigation'
import { CompanyCard } from '@/components/domain/CompanyCard'
import { DocumentList, type UploadValues } from '@/components/domain/DocumentList'
import { ProfileView } from '@/components/domain/ProfileView'
import { RequestStatusBadge, RiskBadge } from '@/components/domain/badges'
import { ResendAttachments } from '@/components/domain/ResendAttachments'
import { RiskPanel } from '@/components/domain/RiskPanel'
import { Timeline } from '@/components/domain/Timeline'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, Field, Input, Select, Skeleton, Tabs, Textarea } from '@/components/ui'
import { api, errorBlockers, errorMessage, upload } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatDate, formatDateTime, formatDocument } from '@/utils/format'

type Tab = 'docs' | 'risk' | 'profile' | 'company' | 'history'

const ACTION_ENDPOINT: Partial<Record<RequestAction, string>> = {
  invite: 'invite',
  cancel: 'cancel',
  reject: 'reject',
  request_changes: 'request-changes',
  send_to_approval: 'send-to-approval',
  return_to_analysis: 'return',
}

function ActionDialog({ action, detail, onClose, onDone }: { action: RequestAction; detail: RequestDetailDTO; onClose: () => void; onDone: (r: RequestDetailDTO) => void }) {
  const rule = ACTIONS[action]
  const [comment, setComment] = useState('')
  const [email, setEmail] = useState(detail.contactEmail)
  // Triagem: Suprimentos escolhe o modelo (documentos exigidos) ao enviar o formulário
  const [modelId, setModelId] = useState(detail.model?.id ?? '')
  const kind = personKindOf(detail.supplier.document)
  const models = useQuery({ queryKey: ['models', 'active'], queryFn: () => api<ModelDTO[]>('/models?active=1'), enabled: action === 'invite' })
  const modelOptions = (models.data ?? []).filter((m) => m.personKind === 'ambos' || m.personKind === kind)
  const m = useMutation({
    mutationFn: () =>
      api<RequestDetailDTO>(`/requests/${detail.id}/${ACTION_ENDPOINT[action]}`, {
        method: 'POST',
        body: action === 'invite' ? { email, message: comment || null, modelId: modelId || undefined } : { comment: comment || undefined },
      }),
    onSuccess: onDone,
  })
  const blockers = errorBlockers(m.error)
  const danger = action === 'reject' || action === 'cancel'
  return (
    <Dialog
      open
      onClose={onClose}
      title={rule.label}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className="mr-auto">
            Voltar
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={m.isPending}
            disabled={(!!rule.commentRequired && !comment.trim()) || (action === 'invite' && !modelId)}
            onClick={() => m.mutate()}
          >
            {rule.label}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {action === 'invite' && (
          <>
            <p>O fornecedor recebe um link pessoal (válido por 15 dias) para preencher os dados e enviar os documentos. Um link anterior deixa de valer.</p>
            <Field label="Modelo de fornecedor" required hint="Define quais documentos o fornecedor vai enviar.">
              <Select value={modelId} onChange={(e) => setModelId(e.target.value)}>
                <option value="">Escolha…</option>
                {modelOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="E-mail do fornecedor" required>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          </>
        )}
        {action === 'request_changes' && <p>O fornecedor recebe um novo link com o texto abaixo e pode corrigir dados e reenviar documentos.</p>}
        {action === 'send_to_approval' && <p>Confere documentos, ficha e risco e envia para quem aprova a gravação no UAU.</p>}
        {action !== 'send_to_approval' && (
          <Field label={action === 'invite' ? 'Mensagem (opcional)' : rule.commentRequired ? 'Motivo' : 'Comentário (opcional)'} required={rule.commentRequired}>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} />
          </Field>
        )}
        {m.isError &&
          (blockers.length ? (
            <Alert tone="warning" title="Ainda não dá para enviar">
              <ul className="list-disc pl-4">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Alert>
          ) : (
            <Alert tone="error">{errorMessage(m.error)}</Alert>
          ))}
      </div>
    </Dialog>
  )
}

function ReviewDialog({ doc, requestId, approve, onClose, onDone }: { doc: DocumentDTO; requestId: string; approve: boolean; onClose: () => void; onDone: (r: RequestDetailDTO) => void }) {
  const [note, setNote] = useState('')
  const [issuedAt, setIssuedAt] = useState(doc.issuedAt ?? '')
  const [expiresAt, setExpiresAt] = useState(doc.expiresAt ?? '')
  const m = useMutation({
    mutationFn: () =>
      api<RequestDetailDTO>(`/requests/${requestId}/documents/${doc.id}/review`, {
        method: 'POST',
        body: { status: approve ? 'aprovado' : 'reprovado', note: note || null, issuedAt: issuedAt || null, expiresAt: expiresAt || null },
      }),
    onSuccess: onDone,
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title={approve ? 'Aprovar documento' : 'Reprovar documento'}
      description={`${doc.documentTypeName} · ${doc.fileName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className="mr-auto">
            Voltar
          </Button>
          <Button variant={approve ? 'primary' : 'danger'} loading={m.isPending} disabled={!approve && !note.trim()} onClick={() => m.mutate()}>
            {approve ? 'Aprovar' : 'Reprovar'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {approve && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Emissão">
              <Input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
            </Field>
            <Field label="Validade" hint="Confira com o documento">
              <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </Field>
          </div>
        )}
        <Field label={approve ? 'Observação (opcional)' : 'Motivo (o fornecedor vai ver)'} required={!approve}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </Field>
        {m.isError && <Alert tone="error">{errorMessage(m.error)}</Alert>}
      </div>
    </Dialog>
  )
}

export default function RequestPage() {
  const { id = '' } = useParams()
  const { can } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('docs')
  const [action, setAction] = useState<RequestAction | null>(null)
  const [review, setReview] = useState<{ doc: DocumentDTO; approve: boolean } | null>(null)
  const q = useQuery({ queryKey: ['request', id], queryFn: () => api<RequestDetailDTO>(`/requests/${id}`) })
  const set = (r: RequestDetailDTO) => {
    qc.setQueryData(['request', id], r)
    void qc.invalidateQueries({ queryKey: ['requests'] })
    void qc.invalidateQueries({ queryKey: ['dashboard'] })
  }
  const risk = useMutation({ mutationFn: () => api<RequestDetailDTO>(`/requests/${id}/risk`, { method: 'POST' }), onSuccess: set })

  if (q.isLoading) return <Skeleton className="h-96" />
  if (q.isError || !q.data) return <Alert tone="error">{errorMessage(q.error)}</Alert>
  const d = q.data
  const analyze = can(PERMISSIONS.requestAnalyze)
  const canReview = analyze && ['em_analise', 'pendencias', 'aguardando_fornecedor'].includes(d.status)
  const c = d.checklist
  const requirements = d.model?.requirements ?? []
  const requiredCount = requirements.filter((r) => r.required).length
  const okCount = requiredCount - c.missing.length - c.pendingReview.length - c.rejected.length - c.expired.length

  const buttons = d.actions.filter((a) => a !== 'supplier_submit' && a !== 'approve')
  return (
    <>
      <PageHeader
        eyebrow="Solicitações"
        backTo={PATHS.requests}
        title={`nº ${d.number} · ${d.supplier.tradeName || d.supplier.legalName}`}
        meta={
          <>
            <RequestStatusBadge status={d.status} />
            {d.urgency === 'alta' && <Badge tone="primary">Urgente</Badge>}
            {d.uauSimulated && <Badge tone="warning">Gravação simulada</Badge>}
          </>
        }
        description={`${formatDocument(d.supplier.document)} · ${d.model?.name ?? 'Modelo a definir na triagem'} · ${STATUS_DESCRIPTIONS[d.status]}`}
        actions={
          <>
            {buttons.map((a) => (
              <Button
                key={a}
                variant={a === 'send_to_approval' || (a === 'invite' && d.status === 'solicitado') ? 'primary' : a === 'reject' || a === 'cancel' ? 'ghost' : 'secondary'}
                icon={a === 'invite' ? <Mail className="size-4" /> : undefined}
                onClick={() => setAction(a)}
              >
                {a === 'invite' && d.status !== 'solicitado' ? 'Reenviar link' : ACTIONS[a].label}
              </Button>
            ))}
            {d.status === 'aguardando_aprovacao' && analyze && (
              <Link to={PATHS.validate(d.id)}>
                <Button variant="primary" icon={<ShieldCheck className="size-4" />}>
                  {can(PERMISSIONS.requestApprove) ? 'Validar e gravar no UAU' : 'Ver validação'}
                </Button>
              </Link>
            )}
          </>
        }
      />

      <div className="mb-6 empty:hidden">
        <ResendAttachments detail={d} onDone={set} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <div className="px-4 pt-2">
            <Tabs<Tab>
              value={tab}
              onChange={setTab}
              items={[
                { key: 'docs', label: 'Documentos', count: d.documents.length },
                { key: 'risk', label: 'Risco' },
                { key: 'profile', label: 'Ficha do fornecedor' },
                ...(d.supplier.receita ? [{ key: 'company' as Tab, label: 'Receita Federal' }] : []),
                { key: 'history', label: 'Histórico', count: d.events.length },
              ]}
            />
          </div>
          <CardBody className="py-5">
            {tab === 'docs' && (
              <DocumentList
                requirements={requirements}
                documents={d.documents}
                fileUrl={(doc) => `/api/documents/${doc.id}/file`}
                onUpload={
                  canReview
                    ? async (v: UploadValues) =>
                        set(await upload<RequestDetailDTO>(`/requests/${id}/documents`, { file: v.file, documentTypeId: v.documentTypeId, issuedAt: v.issuedAt, expiresAt: v.expiresAt }))
                    : undefined
                }
                renderActions={
                  canReview
                    ? (doc) => (
                        <>
                          {doc.reviewStatus !== 'aprovado' && (
                            <Button size="sm" variant="secondary" icon={<Check className="size-4 text-success" />} onClick={() => setReview({ doc, approve: true })}>
                              Aprovar
                            </Button>
                          )}
                          {doc.reviewStatus !== 'reprovado' && (
                            <Button size="sm" variant="ghost" icon={<X className="size-4 text-error" />} onClick={() => setReview({ doc, approve: false })}>
                              Reprovar
                            </Button>
                          )}
                        </>
                      )
                    : undefined
                }
              />
            )}
            {tab === 'risk' && (
              <>
                {risk.isError && <Alert tone="error" className="mb-4">{errorMessage(risk.error)}</Alert>}
                <RiskPanel check={d.latestRisk} onRun={analyze ? () => risk.mutate() : undefined} running={risk.isPending} />
              </>
            )}
            {tab === 'profile' && <ProfileView profile={d.supplier.profile} />}
            {tab === 'company' && d.supplier.receita && <CompanyCard company={d.supplier.receita} />}
            {tab === 'history' && <Timeline events={d.events} />}
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Andamento" />
            <CardBody className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Documentos obrigatórios</span>
                <span className="tabular font-semibold">
                  {okCount}/{requiredCount}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-ink-100">
                <div className="h-full rounded-full bg-success" style={{ width: `${requiredCount ? (okCount / requiredCount) * 100 : 100}%` }} />
              </div>
              {!c.complete && (
                <ul className="space-y-1 text-xs text-ink-700">
                  {c.missing.length > 0 && <li>• {c.missing.length} faltando</li>}
                  {c.pendingReview.length > 0 && <li>• {c.pendingReview.length} a conferir</li>}
                  {c.rejected.length > 0 && <li className="text-error">• {c.rejected.length} reprovado(s)</li>}
                  {c.expired.length > 0 && <li className="text-error">• {c.expired.length} vencido(s)</li>}
                </ul>
              )}
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Risco</span>
                {d.latestRisk ? <RiskBadge level={d.latestRisk.level} compact /> : <Badge>Não avaliado</Badge>}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Ficha preenchida</span>
                {d.supplierSubmittedAt ? <Badge tone="success">Enviada {formatDate(d.supplierSubmittedAt)}</Badge> : <Badge>Ainda não</Badge>}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Link do fornecedor" />
            <CardBody className="space-y-2 text-sm">
              {d.invite ? (
                <>
                  <p>
                    Enviado para <b>{d.invite.email}</b> em {formatDateTime(d.invite.createdAt)}
                  </p>
                  <p className="text-text-muted">
                    {d.invite.active ? `Válido até ${formatDate(d.invite.expiresAt)}` : 'Link expirado ou substituído'} ·{' '}
                    {d.invite.lastAccessAt ? `último acesso ${formatDateTime(d.invite.lastAccessAt)}` : 'ainda não acessado'}
                  </p>
                </>
              ) : (
                <p className="text-text-muted">Ainda não enviado.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Solicitação" />
            <CardBody className="space-y-2 text-sm">
              <p>
                <span className="text-text-muted">Pedida por</span> {d.requester.fullName} em {formatDate(d.createdAt)}
              </p>
              {d.workName && (
                <p>
                  <span className="text-text-muted">Obra</span> {d.workName}
                </p>
              )}
              {d.justification && <p className="rounded-control bg-ink-50 px-3 py-2 text-ink-700">{d.justification}</p>}
              {can(PERMISSIONS.supplierRead) && (
                <Link to={PATHS.supplier(d.supplier.id)} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                  Ficha completa do fornecedor <ExternalLink className="size-3.5" />
                </Link>
              )}
              {d.uauResult && (
                <div className="mt-2 rounded-control border border-border-soft p-3">
                  <p className="flex items-center gap-1 font-medium">
                    <CircleAlert className="size-4 text-info" /> Resultado no UAU
                  </p>
                  <p className="text-text-muted">
                    {d.uauSimulated ? 'Simulação (nada gravado)' : `Código da pessoa: ${String(d.uauResult.codPes ?? '—')}`}
                  </p>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {action && (
        <ActionDialog
          action={action}
          detail={d}
          onClose={() => setAction(null)}
          onDone={(r) => {
            set(r)
            setAction(null)
          }}
        />
      )}
      {review && (
        <ReviewDialog
          doc={review.doc}
          approve={review.approve}
          requestId={d.id}
          onClose={() => setReview(null)}
          onDone={(r) => {
            set(r)
            setReview(null)
          }}
        />
      )}
    </>
  )
}
