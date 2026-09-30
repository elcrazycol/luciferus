import { resolve } from 'node:path'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createDatabase } from './client'

const migrationsFolder = resolve(import.meta.dir, '../drizzle')

async function main() {
  // max: 1 — миграции идут строго последовательно, пул не нужен.
  const db = createDatabase(undefined, { max: 1 })

  console.log(`⏳ Применяю миграции из ${migrationsFolder}`)
  await migrate(db, { migrationsFolder })
  console.log('✅ Миграции применены')
}

try {
  await main()
} catch (error) {
  console.error('❌ Не удалось применить миграции:', error)
  process.exit(1)
}

process.exit(0)
