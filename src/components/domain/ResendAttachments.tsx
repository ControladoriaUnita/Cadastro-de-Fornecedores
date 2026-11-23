import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Paperclip } from 'lucide-react'
import type { RequestDetailDTO, SupplierFullDTO } from '@shared/contracts'
import { PERMISSIONS } from '@shared/domain/roles'
import { Alert, Button, ConfirmDialog } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'

interface PendingItem {
  id: string
  label: string
}

/** Documentos aprovados (e o formulário de qualificação) que ainda não chegaram ao UAU. */
export function pendingUauAttachments(d: RequestDetailDTO): PendingItem[] {
  const docs = d.documents.filter((doc) => doc.reviewStatus === 'aprovado' && !doc.replaced && !doc.uauAttachedAt)
  const items = docs.map((doc) => ({ id: doc.id, label: `${doc.documentTypeName} · ${doc.fileName}` }))
  if (d.qualification.complete && !d.qualification.uauAttachedAt) items.push({ id: 'qualificacao', label: 'Formulário de qualificação (PDF)' })
  return items
}

/** Aviso + botão "Reenviar anexos ao UAU" (com confirmação). Só para quem aprova. */
function ResendBox<T>({ items, codPes, endpoint, onDone }: { items: PendingItem[]; codPes: number; endpoint: string; onDone: (r: T) => void }) {
  const { can } = useAuth()
  const [confirm, setConfirm] = useState(false)
  const m = useMutation({
    mutationFn: () => api<T>(endpoint, { method: 'POST' }),
    onSuccess: (r) => {
      setConfirm(false)
      onDone(r)
    },
  })
  if (!items.length || !can(PERMISSIONS.requestApprove)) return null
  return (
    <>
      <Alert
        tone="warning"
        title={`${items.length} anexo(s) ainda não estão no UAU`}
        action={
          <Button size="sm" variant="primary" icon={<Paperclip className="size-4" />} onClick={() => setConfirm(true)}>
            Reenviar anexos ao UAU
          </Button>
        }
      >
        <ul className="list-disc pl-4">
          {items.map((item) => (
            <li key={item.id}>{item.label}</li>
          ))}
        </ul>
      </Alert>
      <ConfirmDialog
        open={confirm}
        title="Reenviar anexos ao UAU?"
        description={`Os ${items.length} arquivo(s) acima vão para a pessoa ${codPes} no UAU de produção, na pasta do fornecedor.`}
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

/** Na solicitação: só quando ela já foi gravada no UAU de verdade. */
export function ResendAttachments({ detail, onDone }: { detail: RequestDetailDTO; onDone: (r: RequestDetailDTO) => void }) {
  const codPes = detail.supplier.uauCodPes
  if (detail.status !== 'gravado_uau' || detail.uauSimulated || !codPes) return null
  return <ResendBox items={pendingUauAttachments(detail)} codPes={codPes} endpoint={`/requests/${detail.id}/uau-attachments`} onDone={onDone} />
}

/** Na ficha do fornecedor: tudo o que falta de todas as solicitações já gravadas no UAU. */
export function SupplierResendAttachments({ data, onDone }: { data: SupplierFullDTO; onDone: (r: SupplierFullDTO) => void }) {
  const codPes = data.supplier.uauCodPes
  if (!codPes || !data.uauPending.hasUauRequest) return null
  const items = [
    ...data.uauPending.documents,
    ...data.uauPending.forms.map((f) => ({ id: `form-${f.requestId}`, label: `Formulário de qualificação da solicitação nº ${f.number} (PDF)` })),
  ]
  return <ResendBox items={items} codPes={codPes} endpoint={`/suppliers/${data.supplier.id}/uau-attachments`} onDone={onDone} />
}
