/**
 * Aplica as migrações de db/migrations no banco de DATABASE_URL.
 * Uso: npm run db:migrate
 */
import { existsSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { migrate } from 'drizzle-orm/neon-http/migrator'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')
const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL ausente (.env.local).')
  process.exit(1)
}

await migrate(drizzle(neon(url)), { migrationsFolder: './db/migrations' })
console.log('Migrações aplicadas.')
