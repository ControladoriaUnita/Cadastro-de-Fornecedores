/**
 * Resultado da análise de risco: nível, itens (disparou / passou / não consultado) e fontes.
 */
import { CheckCircle2, CircleDashed, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { RiskCheckDTO } from '@shared/contracts'
import { RISK_RULES, SEVERITY_LABELS } from '@shared/domain/risk'
import { Alert, Badge, Button, EmptyState } from '@/components/ui'
import { formatDateTime } from '@/utils/format'
import { RiskBadge } from './badges'

export function RiskPanel({ check, onRun, running }: { check: RiskCheckDTO | null; onRun?: () => void; running?: boolean }) {
  const runButton = onRun && (
    <Button variant={check ? 'secondary' : 'primary'} size="sm" loading={running} onClick={onRun} icon={<ShieldCheck className="size-4" />}>
      {check ? 'Rodar de novo' : 'Rodar análise de risco'}
    </Button>
  )
  if (!check) {
    return <EmptyState title="Análise de risco ainda não feita" description="Consulta a Receita Federal, sanções (CEIS/CNEP) e confere documentos e CNAE com o modelo." action={runButton} />
  }
  const order = { hit: 0, unchecked: 1, ok: 2 }
  const findings = [...check.findings].sort((a, b) => order[a.outcome] - order[b.outcome])
  const transparencia = check.sources.transparencia as { ok?: boolean; message?: string } | undefined
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <RiskBadge level={check.level} />
          {check.blocked && <Badge tone="error">Bloqueia homologação</Badge>}
          <span className="text-sm text-text-muted">
            {formatDateTime(check.ranAt)} · {check.ranByName ?? 'Sistema'}
          </span>
        </div>
        {runButton}
      </div>
      {transparencia && !transparencia.ok && transparencia.message && (
        <Alert tone="warning" title="Sanções não consultadas">
          {transparencia.message}
        </Alert>
      )}
      <ul className="divide-y divide-border-soft rounded-control border border-border-soft">
        {findings.map((f) => {
          const Icon = f.outcome === 'hit' ? ShieldAlert : f.outcome === 'ok' ? CheckCircle2 : CircleDashed
          const color = f.outcome === 'hit' ? (f.severity === 'bloqueio' ? 'text-error' : 'text-warning') : f.outcome === 'ok' ? 'text-success' : 'text-ink-400'
          return (
            <li key={f.key} className="flex items-start gap-3 px-4 py-3">
              <Icon className={`mt-0.5 size-4 shrink-0 ${color}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text">{RISK_RULES[f.key].label}</p>
                <p className="text-sm text-text-muted">{f.message}</p>
              </div>
              {f.outcome === 'hit' && <Badge tone={f.severity === 'bloqueio' ? 'error' : 'warning'}>{SEVERITY_LABELS[f.severity]}</Badge>}
              {f.outcome === 'unchecked' && <Badge>Não consultado</Badge>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
