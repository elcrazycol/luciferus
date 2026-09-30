// Первым делом: корневой .env должен быть в process.env до чтения serverConfig.
import '@luciferus/config/load-env'

import { assertProductionSafety, serverConfig } from '@luciferus/config'
import { currency, formatAmount } from '@luciferus/config/currency'
import { economy } from '@luciferus/config/economy'
import { db } from '@luciferus/db'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { AppError } from './lib/errors'
import { pingRedis } from './lib/redis'
import { adminRoutes } from './routes/admin'
import { authRoutes } from './routes/auth'
import { fairnessRoutes } from './routes/fairness'
import { gameRoutes } from './routes/game'
import { gamesRoutes } from './routes/games'
import { providerRoutes } from './routes/providers'
import { walletRoutes } from './routes/wallet'

const VERSION = '0.3.0'
const startedAt = Date.now()

const app = new Hono()

app.use('*', logger())

/**
 * CORS портала монтируется на конкретные префиксы, а не на весь `/v1/*`.
 *
 * Это не косметика. Hono на `OPTIONS` отдаёт preflight-ответ сразу и не передаёт
 * управление дальше. Если повесить общий CORS на `/v1/*`, он перехватит preflight
 * игровых маршрутов и ответит своей политикой — а до CORS игр дело не дойдёт.
 * В браузере это выглядело бы так: игра «не может достучаться до API», без внятной
 * причины в консоли.
 *
 * У игровых путей своя политика (любой origin, без кук, защита токеном) — она и
 * должна быть единственной, кто отвечает на `/v1/game/*`.
 */
const portalCors = cors({
  origin: (origin) => {
    // Локально пускаем любой origin: портал, дев-песочницу, стороннюю игру на своём порту.
    if (!origin) return undefined
    if (!serverConfig.isProduction) return origin
    return origin === serverConfig.portalUrl ? origin : undefined
  },
  credentials: true,
  allowHeaders: ['Content-Type', 'Authorization'],
})

for (const path of [
  '/v1/auth/*',
  '/v1/wallet/*',
  '/v1/games',
  '/v1/games/*',
  '/v1/providers/*',
  '/v1/fair/*',
  '/v1/admin/*',
  '/v1/config',
]) {
  app.use(path, portalCors)
}

// ─── Служебное ───────────────────────────────────────────────────────────────────

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'luciferus-api',
    version: VERSION,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  }),
)

app.get('/v1/health', async (c) => {
  const [database, redis] = await Promise.all([
    db
      .execute(sql`select 1`)
      .then(() => 'up' as const)
      .catch(() => 'down' as const),
    pingRedis().then((ok) => (ok ? ('up' as const) : ('down' as const))),
  ])

  const ok = database === 'up'

  return c.json(
    {
      ok,
      db: database,
      redis,
      ...(ok ? {} : { hint: 'Поднимите инфраструктуру: bun run infra:up' }),
    },
    ok ? 200 : 503,
  )
})

// ─── Конфиг платформы ────────────────────────────────────────────────────────────

/**
 * Валюта и экономика в одном ответе: портал и SDK берут их отсюда,
 * а не хардкодят значения.
 */
app.get('/v1/config', (c) =>
  c.json({
    currency,
    economy: {
      signupBonus: serverConfig.signupBonus,
      reloadBonus: serverConfig.reloadBonus,
      reloadCooldownMinutes: serverConfig.reloadCooldownMinutes,
      reloadThreshold: economy.reloadThreshold,
    },
    example: formatAmount(1420.5),
  }),
)

// ─── Каталог игр, аккаунты, кошелёк, игры ────────────────────────────────────────

app.route('/v1/games', gamesRoutes)
app.route('/v1/providers', providerRoutes)
app.route('/v1/auth', authRoutes)
app.route('/v1/wallet', walletRoutes)
app.route('/v1/fair', fairnessRoutes)
app.route('/v1/admin', adminRoutes)

// Игровые маршруты живут отдельно от портальных: у них другая авторизация
// (игровой токен вместо сессии) и другой CORS.
app.route('/v1/game', gameRoutes)

// ─── Ошибки ──────────────────────────────────────────────────────────────────────

app.notFound((c) =>
  c.json(
    { error: 'not_found', message: `Нет такого маршрута: ${c.req.method} ${c.req.path}` },
    404,
  ),
)

app.onError((error, c) => {
  // Ожидаемые ошибки (валидация, нехватка средств, лимиты) отдаём как есть.
  if (error instanceof AppError) {
    return c.json(error.toBody(), error.status as ContentfulStatusCode)
  }

  // Всё остальное — наш баг: наружу уходит обезличенный текст.
  console.error('[api] Необработанная ошибка:', error)

  return c.json(
    {
      error: 'internal_error',
      message: serverConfig.isProduction
        ? 'Что-то сломалось на нашей стороне'
        : error instanceof Error
          ? error.message
          : String(error),
    },
    500,
  )
})

// ─── Запуск ──────────────────────────────────────────────────────────────────────

for (const warning of assertProductionSafety()) {
  console.warn(`⚠️  ${warning}`)
}

console.log(`🎰 API готов: http://localhost:${serverConfig.port}`)
console.log(`   портал: ${serverConfig.portalUrl}`)

export { app }

export default {
  port: serverConfig.port,
  fetch: app.fetch,
}
