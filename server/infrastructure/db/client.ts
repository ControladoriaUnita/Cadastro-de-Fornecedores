/**
 * Conexão com o Neon pelo driver HTTP (ideal para funções serverless: sem pool para gerenciar).
 */
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { AppError } from '../../application/context'
import { envValue } from '../env'
import * as schema from './schema'

export type Db = ReturnType<typeof createDb>

function createDb(url: string) {
  return drizzle(neon(url), { schema })
}

let instance: Db | null = null

export function getDb(): Db {
  if (instance) return instance
  const url = envValue('DATABASE_URL')
  if (!url) throw new AppError('DB_NOT_CONFIGURED', 'Banco sem configuração no servidor (DATABASE_URL).', 503)
  return (instance = createDb(url))
}

export { schema }
