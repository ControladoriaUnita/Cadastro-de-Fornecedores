import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Plus } from 'lucide-react'
import type { DashboardDTO, RatedSupplierDTO } from '@shared/contracts'
import { monthLabel, scoreBand } from '@shared/domain/evaluation'
import { MODULE_INFO, type Module } from '@shared/domain/modules'
import { KANBAN_COLUMNS } from '@shared/domain/request/status'
import { statusLabel } from '@shared/domain/terms'
import { RISK_LEVEL_LABELS, type RiskLevel } from '@shared/domain/risk'
import { PERMISSIONS } from '@shared/domain/roles'
import { MODULE_PATHS, PATHS } from '@/app/navigation'
import { ExpiryBadge } from '@/components/domain/badges'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert, Button, Card, CardBody, CardHeader, EmptyState, Kpi, Skeleton } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatDate, formatScore } from '@/utils/format'
import { cn } from '@/utils/cn'

const RISK_BAR: Record<RiskLevel, string> = { baixo: 'bg-success', medio: 'bg-warning', alto: 'bg-error', nao_avaliado: 'bg-ink-300' }

function Bar({ value, max, className }: { value: number; max: number; className: string }) {
  return (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
      <div className={cn('h-full rounded-full', className)} style={{ width: `${max ? Math.max((value / max) * 100, value ? 3 : 0) : 0}%` }} />
    </div>
  )
}

/** Média com cor pela faixa (Ótimo/Bom/Atenção/Crítico). */
function Score({ value, count, muted }: { value: number | null; count: number; muted?: boolean }) {
  const band = scoreBand(value)
  return (
    <span className={cn('tabular text-sm', muted ? 'text-ink-700' : 'font-semibold', band === 'critico' && 'text-error', band === 'atencao' && 'text-warning')}>
      {value === null ? '—' : formatScore(value)} <span className="text-xs font-normal text-text-muted">({count})</span>
    </span>
  )
}

function RatedCard({ title, description, items, empty, warn }: { title: string; description: string; items: RatedSupplierDTO[]; empty: string; warn?: boolean }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {items.length ? (
        <>
          <div className="flex justify-end gap-6 px-5 pt-1 text-xs text-text-muted">
            <span className="w-16 text-right">Geral</span>
            <span className="w-16 text-right">No mês</span>
          </div>
          <ul className="divide-y divide-border-soft">
            {items.map((x) => (
              <li key={x.supplierId} className={cn('flex items-center gap-3 px-5 py-3', warn && (scoreBand(x.overall) === 'critico' || scoreBand(x.overall) === 'atencao') && 'bg-warning-soft/40')}>
                <Link to={PATHS.supplier(x.supplierId)} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-primary">
                  {x.supplierName}
                </Link>
                <span className="w-16 shrink-0 text-right">
                  <Score value={x.overall} count={x.overallCount} />
                </span>
                <span className="w-16 shrink-0 text-right">
                  <Score value={x.month} count={x.monthCount} muted />
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyState title="Sem avaliações ainda" description={empty} />
      )}
    </Card>
  )
}

export default function DashboardPage({ module = 'pj' }: { module?: Module }) {
  const { user, can } = useAuth()
  const q = useQuery({ queryKey: ['dashboard', module], queryFn: () => api<DashboardDTO>(`/dashboard?module=${module}`) })
  const d = q.data
  const pf = module === 'pf'
  const paths = MODULE_PATHS[module]

  return (
    <>
      <PageHeader
        eyebrow={pf ? `Painel · ${MODULE_INFO.pf.label}` : 'Painel'}
        title={`Olá, ${user?.fullName.split(' ')[0] ?? ''}`}
        description={pf ? 'Resumo das pessoas físicas e das solicitações de cadastro.' : 'Resumo dos fornecedores e das solicitações de cadastro.'}
        actions={
          can(PERMISSIONS.requestCreate) && (
            <Link to={paths.newRequest}>
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
            <Kpi label={pf ? 'Pessoas cadastradas' : 'Fornecedores homologados'} value={d.suppliers.homologado} hint={`${d.suppliers.total} no total`} />
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

          <div className={cn('grid gap-6', pf ? '' : 'lg:grid-cols-3')}>
            <Card className={pf ? '' : 'lg:col-span-2'}>
              <CardHeader
                title="Solicitações por etapa"
                actions={
                  <Link to={paths.requests} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                    Abrir kanban <ArrowRight className="size-4" />
                  </Link>
                }
              />
              <CardBody className="space-y-3">
                {KANBAN_COLUMNS.map((s) => {
                  const max = Math.max(...KANBAN_COLUMNS.map((k) => d.requests.byStatus[k]))
                  return (
                    <div key={s} className="flex items-center gap-3">
                      <span className="w-44 shrink-0 text-sm text-ink-700">{statusLabel(s, module)}</span>
                      <Bar value={d.requests.byStatus[s]} max={max} className={s === 'gravado_uau' ? 'bg-success' : 'bg-primary'} />
                      <span className="tabular w-8 text-right text-sm font-semibold">{d.requests.byStatus[s]}</span>
                    </div>
                  )
                })}
              </CardBody>
            </Card>

            {/* Pessoas físicas não têm análise de risco */}
            {!pf && (
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
            )}
          </div>

          <div className={cn('grid gap-6', pf ? '' : 'lg:grid-cols-3')}>
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

            {/* Pessoas físicas não são avaliadas */}
            {!pf && (
            <>
            <RatedCard
              title="Melhores avaliados"
              description={`Maiores médias gerais · média de ${monthLabel(d.ratingMonth)} ao lado`}
              items={d.topRated}
              empty="As obras avaliam o fornecedor na ficha dele."
            />
            <RatedCard
              title="Piores avaliados"
              description={`Menores médias gerais · média de ${monthLabel(d.ratingMonth)} ao lado`}
              items={d.worstRated}
              empty="Nenhum fornecedor avaliado ainda."
              warn
            />
            </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
