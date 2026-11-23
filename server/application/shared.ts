/**
 * Consultas e operações reaproveitadas por vários casos de uso.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { DocumentDTO, ModelDTO } from '../../shared/contracts'
import { ACCEPTED_MIME, MAX_FILE_BYTES } from '../../shared/domain/documents'
import type { RequestStatus } from '../../shared/domain/request/status'
import type { Db } from '../infrastructure/db/client'
import { schema } from '../infrastructure/db/client'
import { sha256 } from '../infrastructure/security'
import { AppError, notFound } from './context'
import { toDocument, toModel } from './mappers'
import type { FileStorage } from './ports'

const { documents, documentTypes, modelRequirements, requestEvents, requests, supplierModels, users } = schema

/**
 * Vencimentos: documento de solicitação cancelada ou recusada não precisa de renovação.
 * Usar com LEFT JOIN em requests por documents.request_id (documento sem solicitação continua valendo).
 */
export const notFromDroppedRequest = sql`(${requests.status} is null or ${requests.status} not in ('cancelado', 'recusado'))`

export async function loadModel(db: Db, modelId: string): Promise<ModelDTO> {
  const [m] = await db.select().from(supplierModels).where(eq(supplierModels.id, modelId))
  if (!m) throw notFound('Modelo de fornecedor')
  const reqs = await db
    .select({ req: modelRequirements, type: documentTypes })
    .from(modelRequirements)
    .innerJoin(documentTypes, eq(documentTypes.id, modelRequirements.documentTypeId))
    .where(eq(modelRequirements.modelId, modelId))
  return toModel(m, reqs)
}

/** Documentos do fornecedor, do mais antigo ao mais novo (os substituídos ficam marcados). */
export async function loadDocuments(db: Db, supplierId: string, opts: { includeReplaced?: boolean } = {}): Promise<DocumentDTO[]> {
  const rows = await db
    .select({ doc: documents, typeName: documentTypes.name, reviewer: users.fullName })
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .leftJoin(users, eq(users.id, documents.reviewedBy))
    .where(and(eq(documents.supplierId, supplierId), opts.includeReplaced ? undefined : isNull(documents.replacedAt)))
    .orderBy(asc(documents.createdAt))
  return rows.map((r) => toDocument(r.doc, r.typeName, r.reviewer))
}

export async function recordEvent(
  db: Db,
  e: {
    requestId: string
    actorId: string | null
    actorLabel: string
    kind: string
    fromStatus?: RequestStatus | null
    toStatus?: RequestStatus | null
    comment?: string | null
    payload?: Record<string, unknown> | null
  },
) {
  await db.insert(requestEvents).values({
    requestId: e.requestId,
    actorId: e.actorId,
    actorLabel: e.actorLabel,
    kind: e.kind,
    fromStatus: e.fromStatus ?? null,
    toStatus: e.toStatus ?? null,
    comment: e.comment ?? null,
    payload: e.payload ?? null,
  })
}

/** Confere o tipo real do arquivo pelos primeiros bytes (não confia na extensão nem no navegador). */
function sniffMime(buf: Buffer): (typeof ACCEPTED_MIME)[number] | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  return null
}

const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' }

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export interface UploadInput {
  supplierId: string
  requestId: string | null
  documentTypeId: string
  file: File
  issuedAt: string | null
  expiresAt: string | null
  uploadedBy: 'supplier' | 'user'
  userId: string | null
  /** Tipos permitidos (os do modelo); null = qualquer tipo ativo */
  allowedTypeIds: string[] | null
}

/** Valida, guarda o arquivo e registra o documento (substituindo o envio anterior do mesmo tipo). */
export async function saveDocument(db: Db, storage: FileStorage, input: UploadInput, now: Date) {
  if (input.allowedTypeIds && !input.allowedTypeIds.includes(input.documentTypeId)) {
    throw new AppError('DOCUMENT_TYPE_NOT_ALLOWED', 'Este documento não faz parte do modelo do fornecedor.', 422)
  }
  const [type] = await db.select().from(documentTypes).where(eq(documentTypes.id, input.documentTypeId))
  if (!type || !type.active) throw notFound('Tipo de documento')
  if (input.file.size === 0) throw new AppError('EMPTY_FILE', 'Arquivo vazio.', 422)
  if (input.file.size > MAX_FILE_BYTES) throw new AppError('FILE_TOO_LARGE', 'Arquivo acima de 4 MB. Reduza o tamanho (ex.: PDF compactado).', 413)
  const data = Buffer.from(await input.file.arrayBuffer())
  const mime = sniffMime(data)
  if (!mime) throw new AppError('FILE_TYPE', 'Envie PDF, PNG ou JPG.', 415)

  // Validade: a informada; senão a padrão do tipo a partir da emissão (ou de hoje)
  let expiresAt = input.expiresAt
  if (type.hasExpiry && !expiresAt && type.defaultValidityDays) {
    expiresAt = addDays(input.issuedAt ?? now.toISOString().slice(0, 10), type.defaultValidityDays)
  }

  const hash = sha256(data)
  // Tira os acentos antes (Certidão → Certidao); o que sobrar fora de [letras, números, . - espaço] vira _
  const safeName =
    input.file.name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w.\- ]+/g, '_')
      .slice(-120) || `documento.${EXT[mime]}`
  const key = `suppliers/${input.supplierId}/${now.getTime()}-${hash.slice(0, 12)}.${EXT[mime]}`
  await storage.put(key, data, mime)

  await db
    .update(documents)
    .set({ replacedAt: now })
    .where(and(eq(documents.supplierId, input.supplierId), eq(documents.documentTypeId, input.documentTypeId), isNull(documents.replacedAt)))
  const [doc] = await db
    .insert(documents)
    .values({
      supplierId: input.supplierId,
      requestId: input.requestId,
      documentTypeId: input.documentTypeId,
      fileName: safeName,
      mime,
      size: data.length,
      storageKey: key,
      sha256: hash,
      uploadedBy: input.uploadedBy,
      uploadedByUserId: input.userId,
      issuedAt: input.issuedAt,
      expiresAt: type.hasExpiry ? expiresAt : null,
    })
    .returning()
  return toDocument(doc!, type.name, null, now)
}

export async function readDocumentFile(db: Db, storage: FileStorage, documentId: string, supplierId?: string) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId))
  if (!doc || (supplierId && doc.supplierId !== supplierId)) throw notFound('Documento')
  return { doc, data: await storage.get(doc.storageKey) }
}

export async function userNames(db: Db, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))]
  if (!unique.length) return new Map<string, string>()
  const rows = await db.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, unique))
  return new Map(rows.map((r) => [r.id, r.name]))
}
