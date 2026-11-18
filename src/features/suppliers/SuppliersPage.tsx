import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Search, Star } from 'lucide-react'
import type { ImportResultDTO, SupplierListItemDTO, UauSyncDTO } from '@shared/contracts'
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
import { cn } from '@/utils/cn'

/** Linhas desenhadas por vez: a base do UAU tem milhares de fornecedores; a busca refina. */
const MAX_ROWS = 200

const OUTCOME_LABEL = { importado: 'Importado', ja_existe: 'Já existia', nao_encontrado: 'Não está no UAU', erro: 'Erro' } as const

type SyncTotals = Omit<UauSyncDTO, 'from' | 'emptyStreak' | 'done'>
const EMPTY_TOTALS: SyncTotals = { read: 0, created: 0, updated: 0, skipped: { pessoa_fisica: 0, inativa: 0, invalida: 0, duplicada: 0 } }
/** Só para a barra de progresso: o maior código de pessoa visto no UAU em 11/2026 era 8.757. */
const EXPECTED_LAST_CODE = 9000

/** Importa a base inteira do UAU, chamando o servidor em etapas até o fim do cadastro. */
function FullSync({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [running, setRunning] = useState(false)
  const [from, setFrom] = useState(0)
  const [done, setDone] = useState(false)
  const [totals, setTotals] = useState<SyncTotals>(EMPTY_TOTALS)
  const [error, setError] = useState<string | null>(null)
  const cancel = useRef(false)

  async function run() {
    setRunning(true)
    setError(null)
    cancel.current = false
    let cursor = { from: done ? 0 : from, emptyStreak: 0 }
    if (done) {
      setTotals(EMPTY_TOTALS)
      setDone(false)
    }
    try {
      for (;;) {
        const r = await api<UauSyncDTO>('/suppliers/uau-sync', { method: 'POST', body: cursor })
        setTotals((t) => ({
          read: t.read + r.read,
          created: t.created + r.created,
          updated: t.updated + r.updated,
          skipped: Object.fromEntries(Object.entries(t.skipped).map(([k, v]) => [k, v + r.skipped[k as keyof SyncTotals['skipped']]])) as SyncTotals['skipped'],
        }))
        setFrom(r.from)
        cursor = { from: r.from, emptyStreak: r.emptyStreak }
        if (r.done) {
          setDone(true)
          break
        }
        if (cancel.current) break
      }
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setRunning(false)
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    }
  }

  const pct = done ? 100 : Math.min(99, Math.round((from / EXPECTED_LAST_CODE) * 100))
  const started = running || from > 0 || done
  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">
        Lê todo o cadastro de pessoas do UAU e traz as <strong className="text-text">pessoas jurídicas ativas</strong> como fornecedores homologados. Pessoas físicas ficam de fora (em boa parte são clientes).
        Quem já está no app não é duplicado: os importados são atualizados e os cadastrados pelo app só ganham o código do UAU. Leva de 1 a 3 minutos; mantenha esta janela aberta.
      </p>
      {started && (
        <div className="space-y-2">
          <div className="h-2 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso da importação">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="tabular text-xs text-text-muted">
            {done ? 'Concluído' : running ? `Lendo pessoas a partir do código ${from.toLocaleString('pt-BR')}…` : `Parado no código ${from.toLocaleString('pt-BR')}`}
          </p>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {[
              ['Pessoas lidas', totals.read],
              ['Novos', totals.created],
              ['Atualizados', totals.updated],
              ['Ignorados', totals.skipped.pessoa_fisica + totals.skipped.inativa + totals.skipped.invalida + totals.skipped.duplicada],
            ].map(([label, n]) => (
              <div key={label} className="rounded-control border border-border-soft px-3 py-2">
                <dt className="text-xs text-text-muted">{label}</dt>
                <dd className="tabular font-semibold">{Number(n).toLocaleString('pt-BR')}</dd>
              </div>
            ))}
          </dl>
          {done && (
            <p className="text-xs text-text-muted">
              Ignorados: {totals.skipped.pessoa_fisica.toLocaleString('pt-BR')} pessoa(s) física(s), {totals.skipped.inativa} inativa(s), {totals.skipped.invalida} sem CNPJ válido e{' '}
              {totals.skipped.duplicada} CNPJ(s) repetido(s) no UAU.
            </p>
          )}
        </div>
      )}
      {error && <Alert tone="error">{error} Clique em continuar para retomar de onde parou.</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} className="mr-auto" disabled={running}>
          Fechar
        </Button>
        {running ? (
          <Button onClick={() => (cancel.current = true)}>Pausar</Button>
        ) : (
          <Button variant="primary" icon={<Download className="size-4" />} onClick={run}>
            {done ? 'Importar de novo' : from > 0 ? 'Continuar' : 'Importar toda a base'}
          </Button>
        )}
      </div>
    </div>
  )
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'base' | 'lista'>('base')
  return (
    <Dialog
      open
      onClose={onClose}
      width="min(92vw, 42rem)"
      title="Importar fornecedores do UAU"
      description="Traz para o app os fornecedores que já estão cadastrados no UAU, para controlar documentos, risco e avaliações."
    >
      <div className="mb-4 inline-flex rounded-control border border-border p-0.5 text-sm" role="tablist">
        {(
          [
            ['base', 'Base inteira'],
            ['lista', 'Por CNPJ'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={mode === key}
            onClick={() => setMode(key)}
            className={cn('rounded-[calc(var(--radius-control)-2px)] px-3 py-1.5 font-medium', mode === key ? 'bg-primary-soft text-primary' : 'text-text-muted hover:text-text')}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === 'base' ? <FullSync onClose={onClose} /> : <ListImport onClose={onClose} />}
    </Dialog>
  )
}

function ListImport({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const docs = [...new Set(text.split(/[\s,;]+/).map(onlyDigits).filter((d) => d.length === 11 || d.length === 14))]
  const m = useMutation({
    mutationFn: () => api<ImportResultDTO>('/suppliers/import', { method: 'POST', body: { documents: docs } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  })
  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">Cole CNPJs/CPFs (um por linha ou separados por vírgula). O app busca cada um no UAU e traz como homologado.</p>
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
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} className="mr-auto">
          Fechar
        </Button>
        <Button variant="primary" disabled={!docs.length || docs.length > 50} loading={m.isPending} onClick={() => m.mutate()}>
          Importar {docs.length || ''}
        </Button>
      </div>
    </div>
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
                {rows.slice(0, MAX_ROWS).map((s) => (
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
            {rows.length > MAX_ROWS && (
              <p className="border-t border-border-soft px-4 py-3 text-xs text-text-muted">
                Mostrando {MAX_ROWS} de {rows.length.toLocaleString('pt-BR')} fornecedores. Use a busca ou o filtro de situação para achar os demais.
              </p>
            )}
          </div>
        ) : (
          <EmptyState title="Nenhum fornecedor" description="Abra uma solicitação de cadastro ou importe a base do UAU." />
        )}
      </Card>
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </>
  )
}
