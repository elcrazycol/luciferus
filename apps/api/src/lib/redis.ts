import { serverConfig } from '@luciferus/config'

/**
 * Клиент Redis. Используем встроенный в Bun `RedisClient`, а не ioredis:
 * рантайм у нас и так Bun, и лишняя зависимость здесь ничего не даёт.
 */
let client: Bun.RedisClient | null = null

export function getRedis(): Bun.RedisClient {
  client ??= new Bun.RedisClient(serverConfig.redisUrl)
  return client
}

/** Проверка доступности Redis — для health-эндпоинта. */
export async function pingRedis(): Promise<boolean> {
  try {
    return (await getRedis().ping()) === 'PONG'
  } catch {
    return false
  }
}

export async function closeRedis(): Promise<void> {
  client?.close()
  client = null
}
