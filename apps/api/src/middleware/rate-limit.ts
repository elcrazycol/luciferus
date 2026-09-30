import { serverConfig } from '@luciferus/config'
import { createMiddleware } from 'hono/factory'
import { AppError } from '../lib/errors'
import { consumeRateLimit } from '../lib/rate-limit'
import { requesterIp } from '../lib/request-meta'
import type { AppEnv } from './session'

function applyHeaders(
  setHeader: (name: string, value: string) => void,
  remaining: number,
  retryAfterSeconds: number,
) {
  setHeader('X-RateLimit-Remaining', String(remaining))
  if (retryAfterSeconds > 0) setHeader('Retry-After', String(retryAfterSeconds))
}

/** Лимит по IP — для анонимных маршрутов: регистрация, вход, каталог. */
export function rateLimitByIp(name: string, limit: number, windowSeconds: number) {
  return createMiddleware(async (c, next) => {
    if (serverConfig.isTest) {
      await next()
      return
    }

    const result = await consumeRateLimit(`ip:${name}:${requesterIp(c)}`, limit, windowSeconds)

    applyHeaders((key, value) => c.header(key, value), result.remaining, result.retryAfterSeconds)

    if (!result.allowed) {
      throw AppError.rateLimited(
        `Слишком много запросов. Попробуйте через ${result.retryAfterSeconds} с`,
        result.retryAfterSeconds,
      )
    }

    await next()
  })
}

/**
 * Лимит по игроку — для операций с балансом.
 *
 * Монтируется ТОЛЬКО после `requireSession`, иначе сессии в контексте не будет.
 */
export function rateLimitByUser(name: string, limit: number, windowSeconds: number) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (serverConfig.isTest) {
      await next()
      return
    }

    const session = c.get('session')
    const result = await consumeRateLimit(`user:${name}:${session.user.id}`, limit, windowSeconds)

    applyHeaders((key, value) => c.header(key, value), result.remaining, result.retryAfterSeconds)

    if (!result.allowed) {
      throw AppError.rateLimited(
        `Слишком много операций. Попробуйте через ${result.retryAfterSeconds} с`,
        result.retryAfterSeconds,
      )
    }

    await next()
  })
}
