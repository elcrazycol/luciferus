import type { Context } from 'hono'

/**
 * Адрес клиента. За обратным прокси реальный адрес приходит в `x-forwarded-for`,
 * и первым в цепочке идёт исходный клиент.
 */
export function requesterIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }

  return c.req.header('x-real-ip') ?? 'unknown'
}

/** Метаданные сессии для аудита: откуда и с каким клиентом вошли. */
export function sessionMeta(c: Context): { ip: string; userAgent?: string } {
  const userAgent = c.req.header('user-agent')
  return userAgent ? { ip: requesterIp(c), userAgent } : { ip: requesterIp(c) }
}
