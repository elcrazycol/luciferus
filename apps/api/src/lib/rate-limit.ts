import { getRedis } from './redis'

export type RateLimitResult = {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

/**
 * Скользящее окно фиксированной длины на счётчике Redis: `INCR` + `EXPIRE`.
 *
 * Осознанные компромиссы:
 * - При недоступном Redis лимит **пропускается** (fail-open). Для площадки без
 *   реальных денег недоступный Redis не должен превращаться в недоступный портал.
 * - Это не строгое скользящее окно: на границе двух окон можно уложиться в
 *   двойной лимит. Для защиты от перебора пароля и флуда ставками этого хватает.
 *
 * Политика «в тестах лимиты выключены» живёт не здесь, а в middleware: сама
 * функция остаётся честной и полностью тестируемой против реального Redis.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const redisKey = `ratelimit:${key}`

  try {
    const redis = getRedis()
    const count = await redis.incr(redisKey)

    let ttl = await redis.ttl(redisKey)
    if (ttl < 0) {
      // Ключ без TTL — либо первый запрос, либо предыдущий INCR успел раньше EXPIRE.
      await redis.expire(redisKey, windowSeconds)
      ttl = windowSeconds
    }

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
    }
  } catch (error) {
    console.warn('[rate-limit] Redis недоступен, лимит пропущен:', error)
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 }
  }
}
