/**
 * Histórico da solicitação (append-only).
 */
import type { EventDTO } from '@shared/contracts'
import { STATUS_LABELS } from '@shared/domain/request/status'
import { formatDateTime } from '@/utils/format'

const KIND_LABELS: Record<string, string> = {
  created: 'Abriu a solicitação',
  invite: 'Enviou o convite ao fornecedor',
  cancel: 'Cancelou',
  reject: 'Recusou',
  supplier_submit: 'Enviou dados e documentos',
  request_changes: 'Devolveu com pendências',
  send_to_approval: 'Enviou para aprovação',
  return_to_analysis: 'Devolveu para análise',
  approve: 'Aprovou e gravou no UAU',
  document_uploaded: 'Enviou documento',
  document_approved: 'Aprovou documento',
  document_rejected: 'Reprovou documento',
  uau_error: 'Erro ao gravar no UAU',
  uau_attach: 'Anexos reenviados ao UAU',
}

export function Timeline({ events }: { events: EventDTO[] }) {
  return (
    <ol className="relative space-y-4 border-l border-border pl-5">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-surface bg-primary" aria-hidden />
          <p className="text-sm">
            <span className="font-medium text-text">{e.actorLabel}</span> <span className="text-ink-700">{KIND_LABELS[e.kind] ?? e.kind}</span>
            {typeof e.payload?.fileName === 'string' && <span className="text-text-muted"> · {e.payload.fileName}</span>}
            {e.toStatus && e.fromStatus !== e.toStatus && <span className="text-text-muted"> → {STATUS_LABELS[e.toStatus]}</span>}
          </p>
          <p className="text-xs text-text-muted">{formatDateTime(e.at)}</p>
          {e.comment && <p className="mt-1 rounded-control bg-ink-50 px-3 py-2 text-sm text-ink-700">{e.comment}</p>}
        </li>
      ))}
    </ol>
  )
}
