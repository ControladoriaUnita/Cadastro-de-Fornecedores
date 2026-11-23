/**
 * Painel de resumo: indicadores de fornecedores, solicitações, risco, vencimentos e avaliações.
 */
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { DashboardDTO, RatedSupplierDTO } from '../../../shared/contracts'
import { monthKey, supplierScores } from '../../../shared/domain/evaluation'
import { expiryState } from '../../../shared/domain/documents'
import { CLOSED_STATUSES, REQUEST_STATUSES, type RequestStatus } from '../../../shared/domain/request/status'
import type { RiskLevel } from '../../../shared/domain/risk'
import { PERMISSIONS } from '../../../shared/domain/roles'
import { schema } from '../../infrastructure/db/client'
import { requirePermission } from '../context'
import { notFromDroppedRequest } from '../shared'
import type { UseCaseDeps } from '../ports'

const { documentTypes, documents, evaluations, requests, suppliers } = schema

export async function getDashboard(deps: UseCaseDeps): Promise<DashboardDTO> {
  requirePermission(deps.ctx.actor, PERMISSIONS.supplierRead)
  const now = deps.ctx.now()
  const since30 = new Date(now.getTime() - 30 * 86_400_000)

  const [sup, reqRows, docRows, evalRows] = await Promise.all([
    deps.db.select({ id: suppliers.id, status: suppliers.status, risk: suppliers.riskLevel, name: suppliers.legalName, trade: suppliers.tradeName }).from(suppliers),
    deps.db.select({ status: requests.status, createdAt: requests.createdAt, closedAt: requests.closedAt }).from(requests),
    deps.db
      .select({ supplierId: documents.supplierId, expiresAt: documents.expiresAt, typeName: documentTypes.name })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .leftJoin(requests, eq(requests.id, documents.requestId))
      .where(and(isNull(documents.replacedAt), sql`${documents.expiresAt} is not null`, notFromDroppedRequest)),
    deps.db.select({ supplierId: evaluations.supplierId, average: evaluations.average, createdAt: evaluations.createdAt }).from(evaluations),
  ])

  const nameOf = new Map(sup.map((s) => [s.id, s.trade || s.name]))
  const countStatus = (st: string) => sup.filter((s) => s.status === st).length
  const byStatus = Object.fromEntries(REQUEST_STATUSES.map((s) => [s, reqRows.filter((r) => r.status === s).length])) as Record<RequestStatus, number>
  const approved = reqRows.filter((r) => r.status === 'gravado_uau' && r.closedAt)
  const avgDays = approved.length
    ? Math.round((approved.reduce((acc, r) => acc + (r.closedAt!.getTime() - r.createdAt.getTime()) / 86_400_000, 0) / approved.length) * 10) / 10
    : null

  const risk = { baixo: 0, medio: 0, alto: 0, nao_avaliado: 0 } as Record<RiskLevel, number>
  for (const s of sup) risk[(s.risk as RiskLevel) ?? 'nao_avaliado']++

  const docs = docRows.map((d) => ({ ...d, expiry: expiryState(d.expiresAt, now) }))
  const expiringList = docs
    .filter((d) => d.expiry === 'vencendo' || d.expiry === 'vencido')
    .sort((a, b) => a.expiresAt!.localeCompare(b.expiresAt!))
    .slice(0, 15)
    .map((d) => ({ supplierId: d.supplierId, supplierName: nameOf.get(d.supplierId) ?? '', documentTypeName: d.typeName, expiresAt: d.expiresAt!, expiry: d.expiry }))

  // Média geral e média do mês corrente de cada fornecedor avaliado
  const evalsBy = new Map<string, { average: number | null; createdAt: Date }[]>()
  for (const e of evalRows) evalsBy.set(e.supplierId, [...(evalsBy.get(e.supplierId) ?? []), e])
  const rated: RatedSupplierDTO[] = []
  for (const [supplierId, list] of evalsBy) {
    const s = supplierScores(list, now, 1)
    if (s.overall === null) continue
    rated.push({ supplierId, supplierName: nameOf.get(supplierId) ?? '', overall: s.overall, overallCount: s.overallCount, month: s.month, monthCount: s.monthCount })
  }

  return {
    suppliers: { total: sup.length, homologado: countStatus('homologado'), em_cadastro: countStatus('em_cadastro'), bloqueado: countStatus('bloqueado'), inativo: countStatus('inativo') },
    requests: {
      open: reqRows.filter((r) => !CLOSED_STATUSES.includes(r.status as RequestStatus)).length,
      byStatus,
      avgDaysToApprove: avgDays,
      createdLast30: reqRows.filter((r) => r.createdAt >= since30).length,
      approvedLast30: approved.filter((r) => r.closedAt! >= since30).length,
    },
    risk,
    documents: { expiring: docs.filter((d) => d.expiry === 'vencendo').length, expired: docs.filter((d) => d.expiry === 'vencido').length },
    expiringList,
    ratingMonth: monthKey(now),
    topRated: [...rated].sort((a, b) => b.overall - a.overall || b.overallCount - a.overallCount).slice(0, 5),
    worstRated: [...rated].sort((a, b) => a.overall - b.overall || b.overallCount - a.overallCount).slice(0, 5),
  }
}
