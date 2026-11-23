import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Paperclip } from 'lucide-react'
import type { RequestDetailDTO } from '@shared/contracts'
import { PERMISSIONS } from '@shared/domain/roles'
import { Alert, Button, ConfirmDialog } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'

/** Documentos aprovados que ainda não chegaram ao UAU (falha na gravação, por exemplo). */
export function pendingUauAttachments(d: RequestDetailDTO) {
  return d.documents.filter((doc) => doc.reviewStatus === 'aprovado' && !doc.replaced && !doc.uauAttachedAt)
}

/**
 * Aviso + botão "Reenviar anexos ao UAU" para solicitação já gravada no UAU de verdade.
 * Só aparece para quem aprova e quando há documento aprovado que ainda não foi anexado.
 */
export function ResendAttachments({ detail, onDone }: { detail: RequestDetailDTO; onDone: (r: RequestDetailDTO) => void }) {
  const { can } = useAuth()
  const [confirm, setConfirm] = useState(false)
  const m = useMutation({
    mutationFn: () => api<RequestDetailDTO>(`/requests/${detail.id}/uau-attachments`, { method: 'POST' }),
    onSuccess: (r) => {
      setConfirm(false)
      onDone(r)
    },
  })
  const pending = pendingUauAttachments(detail)
  const codPes = detail.supplier.uauCodPes
  if (detail.status !== 'gravado_uau' || detail.uauSimulated || !codPes || !pending.length || !can(PERMISSIONS.requestApprove)) return null

  return (
    <>
      <Alert
        tone="warning"
        title={`${pending.length} anexo(s) ainda não estão no UAU`}
        action={
          <Button size="sm" variant="primary" icon={<Paperclip className="size-4" />} onClick={() => setConfirm(true)}>
            Reenviar anexos ao UAU
          </Button>
        }
      >
        <ul className="list-disc pl-4">
          {pending.map((doc) => (
            <li key={doc.id}>
              {doc.documentTypeName} · {doc.fileName}
            </li>
          ))}
        </ul>
      </Alert>
      <ConfirmDialog
        open={confirm}
        title="Reenviar anexos ao UAU?"
        description={`Os ${pending.length} documento(s) acima vão para a pessoa ${codPes} no UAU de produção, na pasta do fornecedor.`}
        confirmLabel="Reenviar anexos"
        loading={m.isPending}
        onConfirm={() => m.mutate()}
        onCancel={() => setConfirm(false)}
      >
        {m.isError && <Alert tone="error">{errorMessage(m.error)}</Alert>}
      </ConfirmDialog>
    </>
  )
}
