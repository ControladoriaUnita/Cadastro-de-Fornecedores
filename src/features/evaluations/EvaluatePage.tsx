import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Star } from 'lucide-react'
import type { EvaluableSupplierDTO, MyEvaluationDTO } from '@shared/contracts'
import { scoreBand } from '@shared/domain/evaluation'
import { EvaluationDialog } from '@/components/domain/EvaluationDialog'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert, Button, Card, CardHeader, EmptyState, Input, Skeleton, Spinner } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { cn } from '@/utils/cn'
import { formatDate, formatDocument, formatScore } from '@/utils/format'

/**
 * Tela "Avaliar" (principalmente para a Obra): busca um fornecedor homologado e dá as notas.
 * Mostra só nome e CNPJ — sem documentos, risco ou Painel.
 */
export default function EvaluatePage() {
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')
  const [target, setTarget] = useState<EvaluableSupplierDTO | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 300)
    return () => clearTimeout(t)
  }, [term])

  const search = useQuery({
    queryKey: ['evaluate-search', debounced],
    queryFn: () => api<EvaluableSupplierDTO[]>(`/evaluate/suppliers?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
  })
  const mine = useQuery({ queryKey: ['my-evaluations'], queryFn: () => api<MyEvaluationDTO[]>('/evaluations/mine') })

  return (
    <>
      <PageHeader eyebrow="Avaliações" title="Avaliar fornecedor" description="Busque o fornecedor homologado que atendeu a obra e dê as notas do fornecimento." />

      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader title="1. Qual fornecedor?" description="Nome, nome fantasia ou CNPJ. Só aparecem fornecedores homologados." />
          <div className="px-5 pb-5">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
              <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Ex.: Vidraçaria, 11.222.333…" className="pl-9" aria-label="Buscar fornecedor" autoFocus />
            </div>
            {saved && (
              <Alert tone="success" className="mt-4">
                Avaliação de {saved} salva. Obrigado!
              </Alert>
            )}
            <div className="mt-4">
              {debounced.length < 2 ? (
                <p className="text-sm text-text-muted">Digite ao menos 2 letras para buscar.</p>
              ) : search.isLoading ? (
                <p className="flex items-center gap-2 text-sm text-text-muted">
                  <Spinner className="size-4 text-primary" /> Buscando…
                </p>
              ) : search.isError ? (
                <Alert tone="error">{errorMessage(search.error)}</Alert>
              ) : search.data?.length ? (
                <ul className="divide-y divide-border-soft rounded-control border border-border-soft">
                  {search.data.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{s.tradeName || s.legalName}</p>
                        <p className="tabular truncate text-xs text-text-muted">
                          {formatDocument(s.document)}
                          {s.tradeName && ` · ${s.legalName}`}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<Star className="size-4" />}
                        onClick={() => {
                          setSaved(null)
                          setTarget(s)
                        }}
                      >
                        Avaliar
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="Nenhum fornecedor homologado encontrado" description="Confira o nome ou o CNPJ. Fornecedor novo? Abra uma solicitação de cadastro." />
              )}
            </div>
          </div>
        </Card>

        <Card className="h-fit">
          <CardHeader title="Minhas avaliações" />
          {mine.isLoading ? (
            <Skeleton className="m-4 h-24" />
          ) : mine.isError ? (
            <Alert tone="error" className="m-4">
              {errorMessage(mine.error)}
            </Alert>
          ) : mine.data?.length ? (
            <ul className="divide-y divide-border-soft">
              {mine.data.map((e) => {
                const band = scoreBand(e.average)
                return (
                  <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{e.supplierName}</p>
                      <p className="truncate text-xs text-text-muted">
                        {e.workName}
                        {e.reference && ` · ${e.reference}`} · {formatDate(e.createdAt)}
                      </p>
                    </div>
                    <span className={cn('tabular inline-flex shrink-0 items-center gap-1 text-sm font-semibold', band === 'critico' && 'text-error', band === 'atencao' && 'text-warning')}>
                      <Star className="size-3.5 fill-primary text-primary" aria-hidden /> {e.average === null ? '—' : formatScore(e.average)}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <EmptyState title="Nenhuma avaliação ainda" description="As avaliações que você fizer aparecem aqui." />
          )}
        </Card>
      </div>

      {target && (
        <EvaluationDialog supplierId={target.id} supplierName={target.tradeName || target.legalName} onClose={() => setTarget(null)} onSaved={() => setSaved(target.tradeName || target.legalName)} />
      )}
    </>
  )
}
