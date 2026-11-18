import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileCheck2, Flame, Plus, Search } from 'lucide-react'
import type { RequestCardDTO } from '@shared/contracts'
import { KANBAN_COLUMNS, STATUS_DESCRIPTIONS, STATUS_LABELS, type RequestStatus } from '@shared/domain/request/status'
import { PERMISSIONS } from '@shared/domain/roles'
import { PATHS } from '@/app/navigation'
import { RequestStatusBadge, RiskBadge } from '@/components/domain/badges'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert, Button, Input, Skeleton } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatDocument, formatRelative } from '@/utils/format'
import { cn } from '@/utils/cn'

function RequestCard({ r }: { r: RequestCardDTO }) {
  return (
    <Link
      to={PATHS.request(r.id)}
      className="block rounded-control border border-border-soft bg-surface p-3 shadow-card transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-hover"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="tabular text-xs font-semibold text-text-muted">nº {r.number}</span>
        {r.urgency === 'alta' && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
            <Flame className="size-3.5" aria-hidden /> Urgente
          </span>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-sm font-semibold text-text">{r.supplierName}</p>
      <p className="tabular text-xs text-text-muted">{formatDocument(r.document)}</p>
      <p className="mt-2 truncate text-xs text-ink-600">{r.modelName}</p>
      {r.workName && <p className="truncate text-xs text-ink-600">Obra: {r.workName}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {r.riskLevel !== 'nao_avaliado' && <RiskBadge level={r.riskLevel} compact />}
        {r.docs.required > 0 && (
          <span className={cn('inline-flex items-center gap-1 text-xs', r.docs.approved === r.docs.required ? 'text-success' : 'text-text-muted')}>
            <FileCheck2 className="size-3.5" aria-hidden />
            {r.docs.approved}/{r.docs.required}
          </span>
        )}
        <span className="ml-auto text-xs text-text-muted">{formatRelative(r.updatedAt)}</span>
      </div>
    </Link>
  )
}

export default function KanbanPage() {
  const { can } = useAuth()
  const seeAll = can(PERMISSIONS.requestReadAll)
  const [scope, setScope] = useState<'all' | 'mine'>(seeAll ? 'all' : 'mine')
  const [search, setSearch] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const q = useQuery({ queryKey: ['requests', scope], queryFn: () => api<RequestCardDTO[]>(`/requests?scope=${scope}`), refetchInterval: 60_000 })

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const digits = term.replace(/\D/g, '')
    return (q.data ?? []).filter(
      (r) =>
        !term ||
        r.supplierName.toLowerCase().includes(term) ||
        (digits && r.document.includes(digits)) ||
        String(r.number) === term ||
        r.workName?.toLowerCase().includes(term) ||
        r.requesterName.toLowerCase().includes(term),
    )
  }, [q.data, search])

  const columns: RequestStatus[] = showClosed ? [...KANBAN_COLUMNS, 'recusado', 'cancelado'] : KANBAN_COLUMNS

  return (
    <>
      <PageHeader
        eyebrow="Solicitações"
        title="Kanban de cadastros"
        description="Cada cartão é uma solicitação. Clique para abrir, conferir e mover de etapa."
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
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por fornecedor, CNPJ, nº, obra…" className="pl-9" aria-label="Buscar" />
        </div>
        {seeAll && (
          <div className="inline-flex rounded-control border border-border bg-surface p-0.5 text-sm" role="group" aria-label="Quais solicitações">
            {(['all', 'mine'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                aria-pressed={scope === s}
                className={cn('rounded-[8px] px-3 py-1.5 font-medium', scope === s ? 'bg-primary-soft text-primary' : 'text-ink-600 hover:text-text')}
              >
                {s === 'all' ? 'Todas' : 'Minhas'}
              </button>
            ))}
          </div>
        )}
        <label className="inline-flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="accent-primary" />
          Mostrar recusadas e canceladas
        </label>
      </div>

      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      <div className="-mx-4 overflow-x-auto px-4 pb-4 lg:-mx-6 lg:px-6">
        <div className="flex min-w-max gap-4 2xl:min-w-0">
          {columns.map((status) => {
            const cards = filtered.filter((r) => r.status === status)
            return (
              <section key={status} className="flex w-64 shrink-0 flex-col rounded-card bg-ink-100/70 p-3 2xl:w-auto 2xl:min-w-0 2xl:flex-1" aria-label={STATUS_LABELS[status]}>
                <header className="mb-3 flex items-center justify-between gap-2 px-1" title={STATUS_DESCRIPTIONS[status]}>
                  <RequestStatusBadge status={status} />
                  <span className="tabular text-sm font-semibold text-ink-600">{q.isLoading ? '…' : cards.length}</span>
                </header>
                <div className="flex flex-col gap-2">
                  {q.isLoading && <Skeleton className="h-28" />}
                  {cards.map((r) => (
                    <RequestCard key={r.id} r={r} />
                  ))}
                  {!q.isLoading && !cards.length && <p className="px-1 py-6 text-center text-xs text-text-muted">Nada aqui</p>}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </>
  )
}
