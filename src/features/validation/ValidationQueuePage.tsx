import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import type { RequestCardDTO } from '@shared/contracts'
import { MODULE_INFO, type Module } from '@shared/domain/modules'
import { PATHS } from '@/app/navigation'
import { RiskBadge } from '@/components/domain/badges'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert, Card, EmptyState, Skeleton } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { formatDocument, formatRelative } from '@/utils/format'

export default function ValidationQueuePage({ module = 'pj' }: { module?: Module }) {
  const q = useQuery({ queryKey: ['requests', module, 'all'], queryFn: () => api<RequestCardDTO[]>(`/requests?scope=all&module=${module}`) })
  const items = (q.data ?? []).filter((r) => r.status === 'aguardando_aprovacao')
  return (
    <>
      <PageHeader
        eyebrow={module === 'pf' ? `Validação ERP · ${MODULE_INFO.pf.label}` : 'Validação ERP'}
        title="Aguardando aprovação"
        description="Confira o que será gravado no UAU e aprove."
      />
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      <Card>
        {q.isLoading ? (
          <Skeleton className="m-4 h-32" />
        ) : items.length ? (
          <ul className="divide-y divide-border-soft">
            {items.map((r) => (
              <li key={r.id}>
                <Link to={PATHS.validate(r.id)} className="flex items-center gap-4 px-5 py-4 hover:bg-ink-50">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      nº {r.number} · {r.supplierName}
                    </p>
                    <p className="text-sm text-text-muted">
                      {formatDocument(r.document)} · {r.modelName ?? '—'} · pedido por {r.requesterName} · {formatRelative(r.updatedAt)}
                    </p>
                  </div>
                  {r.module === 'pj' && <RiskBadge level={r.riskLevel} compact />}
                  <ChevronRight className="size-4 text-ink-400" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nada aguardando aprovação" description={module === 'pf' ? 'Quando a equipe enviar um cadastro para aprovação, ele aparece aqui.' : 'Quando suprimentos enviar um cadastro para aprovação, ele aparece aqui.'} />
        )}
      </Card>
    </>
  )
}
