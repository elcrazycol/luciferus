// Побочный эффект: подтягивает корневой .env ДО чтения serverConfig ниже.
// Порядок импортов здесь значим — не сортируйте их автоматически.
import './env'

import { serverConfig } from '@luciferus/config/server'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export function createDatabase(
  url: string = serverConfig.databaseUrl,
  options: { max?: number } = {},
) {
  // postgres.js устанавливает соединение лениво, при первом запросе — поэтому
  // импорт этого модуля безопасен даже если база ещё не поднята.
  const client = postgres(url, {
    max: options.max ?? 10,
    onnotice: () => {},
  })

  return drizzle(client, { schema })
}

export type Database = ReturnType<typeof createDatabase>

/** Общий инстанс для приложения. В скриптах/тестах лучше создавать свой через createDatabase. */
export const db = createDatabase()
