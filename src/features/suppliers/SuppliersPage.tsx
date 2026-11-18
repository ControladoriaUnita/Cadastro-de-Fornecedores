import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Search, Star } from 'lucide-react'
import type { ImportResultDTO, SupplierListItemDTO } from '@shared/contracts'
import { onlyDigits } from '@shared/domain/document-number'
import { SUPPLIER_STATUS_LABELS, SUPPLIER_STATUSES, type SupplierStatus } from '@shared/domain/supplier'
import { PERMISSIONS } from '@shared/domain/roles'
import { PATHS } from '@/app/navigation'
import { RiskBadge, SupplierStatusBadge } from '@/components/domain/badges'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, Input, Select, Skeleton, Textarea } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatDocument, formatScore } from '@/utils/format'

const OUTCOME_LABEL = { importado: 'Importado', ja_existe: 'Já existia', nao_encontrado: 'Não está no UAU', erro: 'Erro' } as const

function ImportDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const docs = [...new Set(text.split(/[\s,;]+/).map(onlyDigits).filter((d) => d.length === 11 || d.length === 14))]
  const m = useMutation({
    mutationFn: () => api<ImportResultDTO>('/suppliers/import', { method: 'POST', body: { documents: docs } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  })
  return (
    <Dialog
      open
      onClose={onClose}
      width="min(92vw, 40rem)"
      title="Importar fornecedores do UAU"
      description="Cole CNPJs/CPFs (um por linha ou separados por vírgula). O app busca cada um no UAU e traz para o painel como homologado, para controlar documentos e avaliações."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className="mr-auto">
            Fechar
          </Button>
          <Button variant="primary" disabled={!docs.length || docs.length > 50} loading={m.isPending} onClick={() => m.mutate()}>
            Importar {docs.length || ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="CNPJs / CPFs" hint={`${docs.length} válido(s) · até 50 por vez`}>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={'11.222.333/0001-81\n44.555.666/0001-02'} />
        </Field>
        {m.isError && <Alert tone="error">{errorMessage(m.error)}</Alert>}
        {m.data && (
          <ul className="max-h-60 divide-y divide-border-soft overflow-auto rounded-control border border-border-soft text-sm">
            {m.data.results.map((r) => (
              <li key={r.document} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="tabular">{formatDocument(r.document)}</span>
                <span className="text-text-muted">{r.message}</span>
                <Badge tone={r.outcome === 'importado' ? 'success' : r.outcome === 'erro' ? 'error' : 'neutral'}>{OUTCOME_LABEL[r.outcome]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  )
}

export default function SuppliersPage() {
  const { can } = useAuth()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<SupplierStatus | ''>('')
  const [importing, setImporting] = useState(false)
  const q = useQuery({ queryKey: ['suppliers'], queryFn: () => api<SupplierListItemDTO[]>('/suppliers') })

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    const digits = onlyDigits(term)
    return (q.data ?? []).filter(
      (s) =>
        (!status || s.status === status) &&
        (!term || s.legalName.toLowerCase().includes(term) || s.tradeName?.toLowerCase().includes(term) || (digits.length >= 3 && s.document.includes(digits))),
    )
  }, [q.data, search, status])

  return (
    <>
      <PageHeader
        eyebrow="Fornecedores"
        title="Base de fornecedores"
        description="Homologados, em cadastro e importados do UAU, com risco, documentos e avaliação."
        actions={
          can(PERMISSIONS.supplierManage) && (
            <Button icon={<Download className="size-4" />} onClick={() => setImporting(true)}>
              Importar do UAU
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome ou CNPJ/CPF" className="pl-9" aria-label="Buscar fornecedor" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as SupplierStatus | '')} className="w-48" aria-label="Situação">
          <option value="">Todas as situações</option>
          {SUPPLIER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {SUPPLIER_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      <Card className="overflow-hidden">
        {q.isLoading ? (
          <Skeleton className="m-4 h-40" />
        ) : rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-left text-xs font-semibold text-text-muted">
                <tr>
                  <th className="px-4 py-3">Fornecedor</th>
                  <th className="px-4 py-3">Situação</th>
                  <th className="px-4 py-3">Risco</th>
                  <th className="px-4 py-3">Documentos</th>
                  <th className="px-4 py-3">Avaliação</th>
                  <th className="px-4 py-3">UAU</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {rows.map((s) => (
                  <tr key={s.id} className="hover:bg-ink-50">
                    <td className="px-4 py-3">
                      <Link to={PATHS.supplier(s.id)} className="font-medium hover:text-primary">
                        {s.tradeName || s.legalName}
                      </Link>
                      <p className="tabular text-xs text-text-muted">
                        {formatDocument(s.document)}
                        {s.modelName ? ` · ${s.modelName}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <SupplierStatusBadge status={s.status} />
                    </td>
                    <td className="px-4 py-3">
                      <RiskBadge level={s.riskLevel} compact />
                    </td>
                    <td className="px-4 py-3">
                      {s.docsExpired > 0 ? (
                        <Badge tone="error">{s.docsExpired} vencido(s)</Badge>
                      ) : s.docsExpiring > 0 ? (
                        <Badge tone="warning">{s.docsExpiring} vencendo</Badge>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {s.average !== null ? (
                        <span className="inline-flex items-center gap-1 font-medium">
                          <Star className="size-3.5 fill-primary text-primary" aria-hidden /> {formatScore(s.average)}
                          <span className="text-xs font-normal text-text-muted">({s.evaluations})</span>
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="tabular px-4 py-3 text-text-muted">{s.uauCodPes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Nenhum fornecedor" description="Abra uma solicitação de cadastro ou importe a base do UAU." />
        )}
      </Card>
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </>
  )
}
