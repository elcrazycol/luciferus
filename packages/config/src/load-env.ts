import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Корень монорепы. Файл лежит в `packages/config/src`, до корня — три уровня вверх.
 * Считаем через `import.meta.url`, а не `import.meta.dir`, чтобы модуль работал
 * и в Bun, и в Node (Next.js, drizzle-kit, CI).
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

function parseEnvFile(path: string): Record<string, string> {
  const result: Record<string, string> = {}

  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separator = line.indexOf('=')
    if (separator === -1) continue

    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    result[key] = value
  }

  return result
}

/**
 * Подтягивает корневой `.env` в `process.env`.
 *
 * Зачем: пакеты запускают скрипты из своих каталогов, а Bun и Next ищут `.env`
 * только рядом с рабочей директорией. Уже заданные переменные окружения не
 * перетираются — в CI и в докере значения приходят извне.
 *
 * Вызывается как побочный эффект при импорте модуля, поэтому в сервисах
 * импортируйте его ПЕРВОЙ строкой, до чтения конфига.
 */
export function loadRootEnv(): void {
  for (const name of ['.env', '.env.local']) {
    const path = resolve(ROOT, name)
    if (!existsSync(path)) continue

    for (const [key, value] of Object.entries(parseEnvFile(path))) {
      if (process.env[key] === undefined) process.env[key] = value
    }
  }
}

loadRootEnv()
