import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Plus } from 'lucide-react'
import type { DashboardDTO } from '@shared/contracts'
import { KANBAN_COLUMNS, STATUS_LABELS } from '@shared/domain/request/status'
import { RISK_LEVEL_LABELS, type RiskLevel } from '@shared/domain/risk'
import { PERMISSIONS } from '@shared/domain/roles'
import { PATHS } from '@/app/navigation'
import { ExpiryBadge, RequestStatusBadge } from '@/components/domain/badges'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert, Button, Card, CardBody, CardHeader, EmptyState, Kpi, Skeleton } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatDate, formatRelative, formatScore } from '@/utils/format'
import { cn } from '@/utils/cn'

const RISK_BAR: Record<RiskLevel, string> = { baixo: 'bg-success', medio: 'bg-warning', alto: 'bg-error', nao_avaliado: 'bg-ink-300' }

function Bar({ value, max, className }: { value: number; max: number; className: string }) {
  return (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
      <div className={cn('h-full rounded-full', className)} style={{ width: `${max ? Math.max((value / max) * 100, value ? 3 : 0) : 0}%` }} />
    </div>
  )
}

export default function DashboardPage() {
  const { user, can } = useAuth()
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardDTO>('/dashboard') })
  const d = q.data

  return (
    <>
      <PageHeader
        eyebrow="Painel"
        title={`Olá, ${user?.fullName.split(' ')[0] ?? ''}`}
        description="Resumo dos fornecedores e das solicitações de cadastro."
        actions={
          can(PERMISSIONS.requestCreate) && (
            <Link to={PATHS.newRequest}>
              <Button variant="primary" icon={<Plus className="size-4" />}>
                Nova solicitação
              </Button>
            </Link>
          )
        }
      />
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {!d ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Fornecedores homologados" value={d.suppliers.homologado} hint={`${d.suppliers.total} no total`} />
            <Kpi label="Solicitações em andamento" value={d.requests.open} hint={`${d.requests.createdLast30} abertas nos últimos 30 dias`} emphasis={d.requests.open > 0} />
            <Kpi
              label="Tempo médio até o UAU"
              value={d.requests.avgDaysToApprove === null ? '—' : `${formatScore(d.requests.avgDaysToApprove)} dias`}
              hint={`${d.requests.approvedLast30} gravados em 30 dias`}
            />
            <Kpi
              label="Documentos vencidos / vencendo"
              value={`${d.documents.expired} / ${d.documents.expiring}`}
              hint={d.documents.expired ? 'Peça a renovação' : 'Em dia'}
              tone={d.documents.expired ? 'error' : d.documents.expiring ? 'warning' : 'success'}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Solicitações por etapa"
                actions={
                  <Link to={PATHS.requests} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                    Abrir kanban <ArrowRight className="size-4" />
                  </Link>
                }
              />
              <CardBody className="space-y-3">
                {KANBAN_COLUMNS.map((s) => {
                  const max = Math.max(...KANBAN_COLUMNS.map((k) => d.requests.byStatus[k]))
                  return (
                    <div key={s} className="flex items-center gap-3">
                      <span className="w-44 shrink-0 text-sm text-ink-700">{STATUS_LABELS[s]}</span>
                      <Bar value={d.requests.byStatus[s]} max={max} className={s === 'gravado_uau' ? 'bg-success' : 'bg-primary'} />
                      <span className="tabular w-8 text-right text-sm font-semibold">{d.requests.byStatus[s]}</span>
                    </div>
                  )
                })}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Risco dos fornecedores" description="Última análise de cada um" />
              <CardBody className="space-y-3">
                {(['baixo', 'medio', 'alto', 'nao_avaliado'] as RiskLevel[]).map((r) => (
                  <div key={r} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-sm text-ink-700">{RISK_LEVEL_LABELS[r]}</span>
                    <Bar value={d.risk[r]} max={d.suppliers.total} className={RISK_BAR[r]} />
                    <span className="tabular w-8 text-right text-sm font-semibold">{d.risk[r]}</span>
                  </div>
                ))}
                {d.suppliers.bloqueado > 0 && <p className="text-sm text-error">{d.suppliers.bloqueado} fornecedor(es) bloqueado(s).</p>}
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader title="Documentos a renovar" />
              {d.expiringList.length ? (
                <ul className="divide-y divide-border-soft">
                  {d.expiringList.map((x, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <Link to={PATHS.supplier(x.supplierId)} className="block truncate text-sm font-medium hover:text-primary">
                          {x.supplierName}
                        </Link>
                        <p className="truncate text-xs text-text-muted">
                          {x.documentTypeName} · {formatDate(x.expiresAt)}
                        </p>
                      </div>
                      <ExpiryBadge state={x.expiry} />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="Nada vencendo" description="Nenhum documento vence nos próximos 30 dias." />
              )}
            </Card>

            <Card>
              <CardHeader title="Melhor avaliados" />
              {d.topRated.length ? (
                <ul className="divide-y divide-border-soft">
                  {d.topRated.map((x) => (
                    <li key={x.supplierId} className="flex items-center justify-between gap-3 px-5 py-3">
                      <Link to={PATHS.supplier(x.supplierId)} className="truncate text-sm font-medium hover:text-primary">
                        {x.supplierName}
                      </Link>
                      <span className="tabular shrink-0 text-sm font-semibold">
                        {formatScore(x.average)} <span className="text-xs font-normal text-text-muted">({x.evaluations})</span>
                      </span>
                    </li>
                  ))}
                  {d.lowRated.length > 0 && (
                    <li className="bg-warning-soft px-5 py-3 text-sm text-warning">
                      Atenção: {d.lowRated.map((x) => `${x.supplierName} (${formatScore(x.average)})`).join(', ')}
                    </li>
                  )}
                </ul>
              ) : (
                <EmptyState title="Sem avaliações ainda" description="As obras avaliam o fornecedor na ficha dele." />
              )}
            </Card>

            <Card>
              <CardHeader title="Atividade recente" />
              {d.recentActivity.length ? (
                <ul className="divide-y divide-border-soft">
                  {d.recentActivity.map((a, i) => (
                    <li key={i} className="px-5 py-3">
                      <Link to={PATHS.request(a.requestId)} className="flex items-center justify-between gap-2 text-sm font-medium hover:text-primary">
                        <span className="truncate">
                          nº {a.number} · {a.supplierName}
                        </span>
                        {a.toStatus && <RequestStatusBadge status={a.toStatus} />}
                      </Link>
                      <p className="text-xs text-text-muted">
                        {a.actorLabel} · {formatRelative(a.at)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="Nenhuma atividade" />
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  )
}
