import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Code2, Database, FileText, ShieldCheck, Undo2 } from 'lucide-react'
import type { RequestDetailDTO, UauPreviewDTO } from '@shared/contracts'
import { PERMISSIONS } from '@shared/domain/roles'
import { PATHS } from '@/app/navigation'
import { ProfileView } from '@/components/domain/ProfileView'
import { RequestStatusBadge } from '@/components/domain/badges'
import { RiskPanel } from '@/components/domain/RiskPanel'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, Field, Skeleton, Textarea } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatDocument } from '@/utils/format'

type Preview = UauPreviewDTO & { blockers: string[] }

export default function ValidationPage() {
  const { id = '' } = useParams()
  const { can } = useAuth()
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const [returning, setReturning] = useState(false)
  const [comment, setComment] = useState('')
  const [showJson, setShowJson] = useState<number | null>(null)
  const detail = useQuery({ queryKey: ['request', id], queryFn: () => api<RequestDetailDTO>(`/requests/${id}`) })
  const preview = useQuery({ queryKey: ['uau-preview', id], queryFn: () => api<Preview>(`/requests/${id}/uau-preview`) })
  const done = (r: RequestDetailDTO) => {
    qc.setQueryData(['request', id], r)
    void qc.invalidateQueries({ queryKey: ['requests'] })
    void qc.invalidateQueries({ queryKey: ['dashboard'] })
    void qc.invalidateQueries({ queryKey: ['uau-preview', id] })
  }
  const approve = useMutation({ mutationFn: () => api<RequestDetailDTO>(`/requests/${id}/approve`, { method: 'POST' }), onSuccess: (r) => (done(r), setConfirm(false)) })
  const back = useMutation({
    mutationFn: () => api<RequestDetailDTO>(`/requests/${id}/return`, { method: 'POST', body: { comment } }),
    onSuccess: (r) => (done(r), setReturning(false)),
  })

  if (detail.isLoading || preview.isLoading) return <Skeleton className="h-96" />
  if (detail.isError || !detail.data) return <Alert tone="error">{errorMessage(detail.error)}</Alert>
  const d = detail.data
  const p = preview.data
  const canApprove = can(PERMISSIONS.requestApprove) && d.status === 'aguardando_aprovacao'
  const ready = !!p && !p.blockers.length && !p.profileErrors.length && !p.duplicate.error

  return (
    <>
      <PageHeader
        eyebrow="Validação ERP"
        backTo={PATHS.validation}
        title={d.supplier.legalName}
        meta={<RequestStatusBadge status={d.status} />}
        description={`nº ${d.number} · ${formatDocument(d.supplier.document)} · ${d.model?.name ?? "—"}`}
        actions={
          <>
            <Link to={PATHS.request(d.id)}>
              <Button variant="ghost">Abrir solicitação</Button>
            </Link>
            {canApprove && (
              <>
                <Button icon={<Undo2 className="size-4" />} onClick={() => setReturning(true)}>
                  Devolver para análise
                </Button>
                <Button variant="primary" icon={<ShieldCheck className="size-4" />} disabled={!ready} onClick={() => setConfirm(true)}>
                  Aprovar e gravar no UAU
                </Button>
              </>
            )}
          </>
        }
      />

      {preview.isError && <Alert tone="error">{errorMessage(preview.error)}</Alert>}
      {p && (
        <div className="space-y-6">
          <Alert tone={p.writeEnabled ? 'warning' : 'info'} title={p.writeEnabled ? 'Gravação real ligada' : 'Modo simulação'}>
            {p.writeEnabled
              ? 'Ao aprovar, a pessoa, o telefone, a conta e os anexos serão gravados no UAU de produção.'
              : 'Ao aprovar, o fluxo é concluído e o fornecedor fica homologado no app, mas nada é gravado no UAU (UAU_GRAVACAO=simulacao).'}
          </Alert>
          {d.status === 'gravado_uau' && (
            <Alert tone="success" title="Concluído">
              {d.uauSimulated ? 'Aprovado em simulação.' : `Gravado no UAU — código da pessoa ${String(d.uauResult?.codPes ?? '—')}.`}
            </Alert>
          )}
          {p.blockers.length > 0 && d.status === 'aguardando_aprovacao' && (
            <Alert tone="error" title="Pendências antes de aprovar">
              <ul className="list-disc pl-4">
                {p.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Alert>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Situação no UAU" />
              <CardBody className="space-y-2 text-sm">
                {p.duplicate.error ? (
                  <Alert tone="error">Não foi possível consultar o UAU: {p.duplicate.error}</Alert>
                ) : p.duplicate.found ? (
                  <p className="flex items-center gap-2">
                    <Database className="size-4 text-info" /> Já existe no UAU (código <b>{p.duplicate.codPes}</b>
                    {p.duplicate.name ? ` · ${p.duplicate.name}` : ''}). Não será criada outra pessoa: os documentos serão anexados nela.
                  </p>
                ) : (
                  <p className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-success" /> Não existe no UAU: será criada como <b>confirmada e ativa</b>.
                  </p>
                )}
                {p.profileErrors.length > 0 && (
                  <Alert tone="error" title="Ficha com erros">
                    <ul className="list-disc pl-4">
                      {p.profileErrors.map((e) => (
                        <li key={e.path}>
                          {e.path}: {e.message}
                        </li>
                      ))}
                    </ul>
                  </Alert>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={`Anexos que vão para o UAU (${p.attachments.length})`} description='Chave "Pessoas <código>"' />
              <CardBody>
                {p.attachments.length ? (
                  <ul className="space-y-1.5 text-sm">
                    {p.attachments.map((a) => (
                      <li key={a.documentId} className="flex items-center gap-2">
                        <FileText className="size-4 text-primary" />
                        <a href={`/api/documents/${a.documentId}/file`} target="_blank" rel="noreferrer" className="hover:text-primary">
                          {a.documentTypeName} · {a.fileName}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-text-muted">Nenhum documento aprovado.</p>
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Ficha cadastral" />
            <CardBody>
              <ProfileView profile={d.supplier.profile} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Análise de risco" />
            <CardBody>
              <RiskPanel check={d.latestRisk} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Chamadas ao UAU" description="Exatamente o que será enviado (o conteúdo dos arquivos aparece resumido)." />
            <ul className="divide-y divide-border-soft">
              {p.steps.map((s, i) => (
                <li key={i} className="px-5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm">
                      <Badge tone="info" className="mr-2">
                        {i + 1}
                      </Badge>
                      <code className="font-mono text-xs">{s.route}</code> <span className="text-text-muted">· {s.description}</span>
                    </p>
                    <Button size="sm" variant="ghost" icon={<Code2 className="size-4" />} onClick={() => setShowJson(showJson === i ? null : i)}>
                      {showJson === i ? 'Ocultar JSON' : 'Ver JSON'}
                    </Button>
                  </div>
                  {showJson === i && <pre className="mt-2 max-h-96 overflow-auto rounded-control bg-ink-900 p-3 text-xs text-ink-100">{JSON.stringify(s.body, null, 2)}</pre>}
                </li>
              ))}
              {!p.steps.length && <li className="px-5 py-4 text-sm text-text-muted">Sem chamadas (ficha incompleta).</li>}
            </ul>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        title={p?.writeEnabled ? 'Gravar no UAU?' : 'Aprovar em simulação?'}
        description={p?.writeEnabled ? 'Esta ação cria/atualiza dados no UAU de produção e não pode ser desfeita pelo app.' : 'Nada será gravado no UAU.'}
        confirmLabel={p?.writeEnabled ? 'Gravar no UAU' : 'Aprovar'}
        loading={approve.isPending}
        onConfirm={() => approve.mutate()}
        onCancel={() => setConfirm(false)}
      >
        {approve.isError && <Alert tone="error">{errorMessage(approve.error)}</Alert>}
      </ConfirmDialog>
      <ConfirmDialog
        open={returning}
        title="Devolver para análise"
        confirmLabel="Devolver"
        loading={back.isPending}
        onConfirm={() => comment.trim() && back.mutate()}
        onCancel={() => setReturning(false)}
      >
        <Field label="Motivo" required>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
        </Field>
        {back.isError && <Alert tone="error" className="mt-3">{errorMessage(back.error)}</Alert>}
      </ConfirmDialog>
    </>
  )
}
