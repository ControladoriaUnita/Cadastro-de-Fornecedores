/**
 * Lista de documentos por exigência do modelo: o que foi enviado, situação, validade e ações.
 * Usada na análise (com conferência), na ficha do fornecedor e no portal.
 */
import { useRef, useState, type ReactNode } from 'react'
import { Eye, FileText, Upload } from 'lucide-react'
import type { DocumentDTO, RequirementDTO } from '@shared/contracts'
import { ACCEPTED_MIME, MAX_FILE_BYTES } from '@shared/domain/documents'
import { Badge, Button, Field, Input } from '@/components/ui'
import { formatBytes, formatDate, formatDateTime } from '@/utils/format'
import { cn } from '@/utils/cn'
import { ExpiryBadge, ReviewBadge } from './badges'

export interface UploadValues {
  file: File
  documentTypeId: string
  issuedAt: string | null
  expiresAt: string | null
}

interface Props {
  requirements: RequirementDTO[]
  documents: DocumentDTO[]
  /** URL para abrir o arquivo */
  fileUrl: (doc: DocumentDTO) => string
  onUpload?: (v: UploadValues) => Promise<unknown>
  /** Ações extras por documento (ex.: aprovar/reprovar) */
  renderActions?: (doc: DocumentDTO, req: RequirementDTO) => ReactNode
  /** Mostra documentos que não pertencem ao modelo (ficha do fornecedor) */
  extraDocuments?: boolean
}

function UploadRow({ req, onUpload }: { req: RequirementDTO; onUpload: NonNullable<Props['onUpload']> }) {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [issuedAt, setIssuedAt] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pick = (f: File | null) => {
    setError(null)
    if (!f) return setFile(null)
    if (!(ACCEPTED_MIME as readonly string[]).includes(f.type)) return setError('Envie PDF, PNG ou JPG.')
    if (f.size > MAX_FILE_BYTES) return setError(`Arquivo acima de ${formatBytes(MAX_FILE_BYTES)}.`)
    setFile(f)
  }

  const send = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      await onUpload({ file, documentTypeId: req.documentTypeId, issuedAt: issuedAt || null, expiresAt: expiresAt || null })
      setFile(null)
      setIssuedAt('')
      setExpiresAt('')
      if (input.current) input.current.value = ''
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no envio.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-control border border-dashed border-border bg-ink-50 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <input ref={input} type="file" accept=".pdf,.png,.jpg,.jpeg" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} aria-label={`Arquivo: ${req.name}`} />
        <Button size="sm" icon={<Upload className="size-4" />} onClick={() => input.current?.click()}>
          {file ? 'Trocar arquivo' : 'Escolher arquivo'}
        </Button>
        {file && <span className="min-w-0 truncate text-sm text-ink-700">{file.name}</span>}
        {file && req.hasExpiry && (
          <>
            <Field label="Emissão" className="w-40">
              <Input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} className="h-8" />
            </Field>
            <Field label="Validade" className="w-40" hint={!expiresAt && req.defaultValidityDays ? `Padrão: ${req.defaultValidityDays} dias` : undefined}>
              <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="h-8" />
            </Field>
          </>
        )}
        {file && (
          <Button size="sm" variant="primary" loading={busy} onClick={send}>
            Enviar
          </Button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-error">{error}</p>}
      <p className="mt-2 text-xs text-text-muted">PDF, PNG ou JPG até {formatBytes(MAX_FILE_BYTES)}.</p>
    </div>
  )
}

export function DocumentList({ requirements, documents, fileUrl, onUpload, renderActions, extraDocuments }: Props) {
  const latest = new Map<string, DocumentDTO>()
  for (const d of documents) if (!d.replaced) latest.set(d.documentTypeId, d)
  const extras = extraDocuments ? documents.filter((d) => !d.replaced && !requirements.some((r) => r.documentTypeId === d.documentTypeId)) : []

  return (
    <ul className="divide-y divide-border-soft">
      {requirements.map((req) => {
        const doc = latest.get(req.documentTypeId)
        return (
          <li key={req.documentTypeId} className="py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <FileText className={cn('size-4 shrink-0', doc ? 'text-primary' : 'text-ink-400')} aria-hidden />
                  <p className="font-medium text-text">{req.name}</p>
                  {req.required ? <Badge tone="neutral">Obrigatório</Badge> : <Badge tone="info">Opcional</Badge>}
                </div>
                {(req.instructions || req.description) && <p className="mt-0.5 text-sm text-text-muted">{req.instructions || req.description}</p>}
                {doc ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <a href={fileUrl(doc)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                      <Eye className="size-4" aria-hidden /> {doc.fileName}
                    </a>
                    <span className="text-text-muted">
                      {formatBytes(doc.size)} · enviado {formatDateTime(doc.createdAt)} {doc.uploadedBy === 'supplier' ? 'pelo fornecedor' : 'pela equipe'}
                    </span>
                    <ReviewBadge status={doc.reviewStatus} />
                    <ExpiryBadge state={doc.expiry} />
                    {doc.expiresAt && <span className="text-text-muted">validade {formatDate(doc.expiresAt)}</span>}
                    {doc.uauAttachedAt && <Badge tone="success">Anexado no UAU</Badge>}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-text-muted">Nenhum arquivo enviado.</p>
                )}
                {doc?.reviewStatus === 'reprovado' && doc.reviewNote && (
                  <p className="mt-2 rounded-control bg-error-soft px-3 py-2 text-sm text-error">Motivo: {doc.reviewNote}</p>
                )}
              </div>
              {doc && renderActions && <div className="flex shrink-0 flex-wrap gap-2">{renderActions(doc, req)}</div>}
            </div>
            {onUpload && <UploadRow req={req} onUpload={onUpload} />}
          </li>
        )
      })}
      {extras.map((doc) => (
        <li key={doc.id} className="py-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <FileText className="size-4 text-ink-400" aria-hidden />
            <span className="font-medium">{doc.documentTypeName}</span>
            <a href={fileUrl(doc)} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              {doc.fileName}
            </a>
            <ReviewBadge status={doc.reviewStatus} />
            <ExpiryBadge state={doc.expiry} />
          </div>
        </li>
      ))}
    </ul>
  )
}
