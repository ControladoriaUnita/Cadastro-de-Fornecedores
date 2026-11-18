/**
 * Conversão de linhas do banco em DTOs da API.
 */
import type { CompanyDTO, DocumentDTO, EventDTO, ModelDTO, RiskCheckDTO, SupplierDetailDTO } from '../../shared/contracts'
import { expiryState, type ReviewStatus } from '../../shared/domain/documents'
import type { RequestStatus } from '../../shared/domain/request/status'
import type { RiskFinding, RiskLevel } from '../../shared/domain/risk'
import type { SupplierStatus } from '../../shared/domain/supplier'
import type { schema } from '../infrastructure/db/client'

type Row<T extends { $inferSelect: unknown }> = T['$inferSelect']

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

export function toSupplierDetail(s: Row<typeof schema.suppliers>, modelName: string | null): SupplierDetailDTO {
  return {
    id: s.id,
    document: s.document,
    personKind: s.personKind as 'PJ' | 'PF',
    legalName: s.legalName,
    tradeName: s.tradeName,
    email: s.email,
    status: s.status as SupplierStatus,
    modelId: s.modelId,
    modelName,
    profile: s.profile,
    receita: (s.receita as CompanyDTO | null) ?? null,
    receitaCheckedAt: iso(s.receitaCheckedAt),
    riskLevel: s.riskLevel as RiskLevel,
    riskCheckedAt: iso(s.riskCheckedAt),
    uauCodPes: s.uauCodPes,
    uauSyncedAt: iso(s.uauSyncedAt),
    source: s.source as 'app' | 'uau',
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }
}

export function toDocument(
  d: Row<typeof schema.documents>,
  typeName: string,
  reviewerName: string | null,
  today = new Date(),
): DocumentDTO {
  return {
    id: d.id,
    documentTypeId: d.documentTypeId,
    documentTypeName: typeName,
    fileName: d.fileName,
    mime: d.mime,
    size: d.size,
    uploadedBy: d.uploadedBy as 'supplier' | 'user',
    issuedAt: d.issuedAt,
    expiresAt: d.expiresAt,
    expiry: expiryState(d.expiresAt, today),
    reviewStatus: d.reviewStatus as ReviewStatus,
    reviewNote: d.reviewNote,
    reviewedByName: reviewerName,
    reviewedAt: iso(d.reviewedAt),
    replaced: !!d.replacedAt,
    uauAttachedAt: iso(d.uauAttachedAt),
    createdAt: d.createdAt.toISOString(),
  }
}

export function toEvent(e: Row<typeof schema.requestEvents>): EventDTO {
  return {
    id: e.id,
    at: e.at.toISOString(),
    actorLabel: e.actorLabel,
    kind: e.kind,
    fromStatus: e.fromStatus as RequestStatus | null,
    toStatus: e.toStatus as RequestStatus | null,
    comment: e.comment,
    payload: e.payload ?? null,
  }
}

export function toRiskCheck(r: Row<typeof schema.riskChecks>, ranByName: string | null): RiskCheckDTO {
  return {
    id: r.id,
    ranAt: r.ranAt.toISOString(),
    ranByName,
    level: r.level as RiskLevel,
    blocked: r.blocked,
    findings: r.findings as RiskFinding[],
    sources: r.sources,
  }
}

export function toModel(
  m: Row<typeof schema.supplierModels>,
  reqs: { req: Row<typeof schema.modelRequirements>; type: Row<typeof schema.documentTypes> }[],
): ModelDTO {
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    personKind: m.personKind as ModelDTO['personKind'],
    expectedCnaePrefixes: m.expectedCnaePrefixes,
    active: m.active,
    requirements: reqs
      .sort((a, b) => a.req.sort - b.req.sort)
      .map(({ req, type }) => ({
        documentTypeId: type.id,
        name: type.name,
        description: type.description,
        hasExpiry: type.hasExpiry,
        defaultValidityDays: type.defaultValidityDays,
        required: req.required,
        instructions: req.instructions,
      })),
  }
}
