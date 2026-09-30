import { loginRequestSchema, registerRequestSchema } from '@luciferus/protocol/auth'
import { Hono } from 'hono'
import { parseJson } from '../lib/http'
import { sessionMeta } from '../lib/request-meta'
import { rateLimitByIp } from '../middleware/rate-limit'
import { type AppEnv, requireSession } from '../middleware/session'
import { login, register, revokeSession } from '../services/auth'
import { getWalletSummary } from '../services/wallet'

export const authRoutes = new Hono<AppEnv>()

// Лимиты подобраны так, чтобы не мешать живому человеку, но сделать перебор
// паролей и массовую регистрацию бессмысленными.
const REGISTER_LIMIT = 10
const LOGIN_LIMIT = 20

authRoutes.post('/register', rateLimitByIp('auth:register', REGISTER_LIMIT, 3_600), async (c) => {
  const body = await parseJson(c, registerRequestSchema)
  const result = await register(body, sessionMeta(c))
  return c.json(result, 201)
})

authRoutes.post('/login', rateLimitByIp('auth:login', LOGIN_LIMIT, 300), async (c) => {
  const body = await parseJson(c, loginRequestSchema)
  const result = await login(body, sessionMeta(c))
  return c.json(result)
})

authRoutes.post('/logout', requireSession, async (c) => {
  await revokeSession(c.get('session').sessionId)
  return c.json({ ok: true })
})

/** Профиль и кошелёк одним запросом — этим живёт шапка портала. */
authRoutes.get('/me', requireSession, async (c) => {
  const session = c.get('session')
  const wallet = await getWalletSummary(session.user.id)
  return c.json({ user: session.user, wallet })
})
