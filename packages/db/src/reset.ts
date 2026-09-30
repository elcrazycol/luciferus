import { sql } from 'drizzle-orm'
import { db } from './client'
import { seed } from './seed'

/**
 * Сбрасывает данные и засевает заново. Схему не трогает — сначала `bun run db:migrate`.
 *
 * ledger стирается вместе с остальным: это append-only журнал, но в локальной
 * разработке он и так не является аудиторским доказательством.
 */
async function reset(): Promise<void> {
  console.log('🧨 Чищу таблицы…')

  await db.execute(
    sql`TRUNCATE TABLE ${sql.identifier('ledger')}, ${sql.identifier('wallets')}, ${sql.identifier('sessions')}, ${sql.identifier('game_versions')}, ${sql.identifier('games')}, ${sql.identifier('providers')}, ${sql.identifier('users')} RESTART IDENTITY CASCADE`,
  )

  console.log('   таблицы пусты')
  await seed()
}

try {
  await reset()
} catch (error) {
  console.error('❌ Не удалось сбросить данные:', error)
  process.exit(1)
}

process.exit(0)
