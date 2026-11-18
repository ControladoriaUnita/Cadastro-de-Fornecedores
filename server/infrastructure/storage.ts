/**
 * Armazenamento dos arquivos enviados:
 *   BLOB_READ_WRITE_TOKEN definido → Vercel Blob (acesso privado; o download passa pela nossa API)
 *   sem token                       → disco local em .data/uploads (somente desenvolvimento)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import { AppError } from '../application/context'
import type { FileStorage } from '../application/ports'
import { envValue, isProduction } from './env'

const LOCAL_ROOT = join(process.cwd(), '.data', 'uploads')

class LocalStorage implements FileStorage {
  readonly kind = 'local' as const
  private path(key: string) {
    const p = normalize(join(LOCAL_ROOT, key))
    if (!p.startsWith(LOCAL_ROOT + sep)) throw new AppError('INVALID_KEY', 'Caminho de arquivo inválido.', 400)
    return p
  }
  async put(key: string, data: Buffer) {
    const p = this.path(key)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, data)
    return { key, size: data.length }
  }
  async get(key: string) {
    return readFile(this.path(key))
  }
}

class BlobStorage implements FileStorage {
  readonly kind = 'vercel-blob' as const
  constructor(private readonly token: string) {}
  async put(key: string, data: Buffer, mime: string) {
    const { put } = await import('@vercel/blob')
    const blob = await put(key, data, { access: 'private', contentType: mime, token: this.token, addRandomSuffix: false })
    return { key: blob.pathname, size: data.length }
  }
  async get(key: string) {
    const { get } = await import('@vercel/blob')
    const res = await get(key, { access: 'private', token: this.token })
    if (!res || res.statusCode !== 200) throw new AppError('FILE_NOT_FOUND', 'Arquivo não encontrado no armazenamento.', 404)
    return Buffer.from(await new Response(res.stream).arrayBuffer())
  }
}

let instance: FileStorage | null = null

export function getStorage(): FileStorage {
  if (instance) return instance
  const token = envValue('BLOB_READ_WRITE_TOKEN')
  if (token) return (instance = new BlobStorage(token))
  if (isProduction()) throw new AppError('STORAGE_NOT_CONFIGURED', 'Armazenamento de arquivos sem configuração (BLOB_READ_WRITE_TOKEN).', 503)
  return (instance = new LocalStorage())
}

export const storageKind = () => (envValue('BLOB_READ_WRITE_TOKEN') ? 'vercel-blob' : 'local')
