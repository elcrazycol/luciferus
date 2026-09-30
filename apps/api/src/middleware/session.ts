import { createMiddleware } from 'hono/factory'
import { AppError } from '../lib/errors'
import { type AuthenticatedSession, resolveSession } from '../services/auth'

/** Что доступно в контексте запроса после `requireSession`. */
export type AppEnv = {
  Variables: {
    session: AuthenticatedSession
  }
}

/**
 * Достаёт токен из заголовка `Authorization: Bearer <token>`.
 *
 * API намеренно ничего не знает про куки: сессионную куку держит портал на своём
 * домене, а с API общается токеном. Так прод не зависит от того, на одном домене
 * живут портал и API или нет.
 */
export function extractSessionToken(authorization: string | undefined): string | null {
  if (!authorization) return null

  const [scheme, value] = authorization.split(' ')
  if (!value || scheme?.toLowerCase() !== 'bearer') return null

  return value.trim() || null
}

/** Пропускает только запросы с действующей сессией, иначе — 401. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const token = extractSessionToken(c.req.header('authorization'))
  if (!token) throw AppError.unauthorized()

  const session = await resolveSession(token)
  if (!session) throw AppError.unauthorized('Сессия истекла — войдите заново')

  c.set('session', session)
  await next()
})
