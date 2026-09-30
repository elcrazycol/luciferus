// Первым делом: корневой .env должен быть в process.env до чтения serverConfig.
import '@luciferus/config/load-env'

import { assertProductionSafety, serverConfig } from '@luciferus/config'
import { currency, formatAmount } from '@luciferus/config/currency'
import { economy } from '@luciferus/config/economy'
import { db } from '@luciferus/db'
import { games, providers } from '@luciferus/db/schema'
import { and, arrayContains, asc, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { AppError } from './lib/errors'
import { pingRedis } from './lib/redis'
import { authRoutes } from './routes/auth'
import { walletRoutes } from './routes/wallet'

const VERSION = '0.2.0'
const startedAt = Date.now()

const app = new Hono()

app.use('*', logger())

app.use(
  '/v1/*',
  cors({
    origin: (origin) => {
      // Локально пускаем любой origin: портал, дев-песочницу, стороннюю игру на своём порту.
      if (!origin) return undefined
      if (!serverConfig.isProduction) return origin
      return origin === serverConfig.portalUrl ? origin : undefined
    },
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
)

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

// ─── Каталог игр ─────────────────────────────────────────────────────────────────

const gameCardColumns = {
  slug: games.slug,
  title: games.title,
  description: games.description,
  categories: games.categories,
  tags: games.tags,
  volatility: games.volatility,
  rtp: games.rtp,
  fairMode: games.fairMode,
  limits: games.limits,
  thumbnailUrl: games.thumbnailUrl,
  embedUrl: games.embedUrl,
  isStub: games.isStub,
  providerSlug: providers.slug,
  providerName: providers.name,
  providerVerified: providers.verified,
}

app.get('/v1/games', async (c) => {
  const category = c.req.query('category')

  const rows = await db
    .select(gameCardColumns)
    .from(games)
    .leftJoin(providers, eq(games.providerId, providers.id))
    .where(
      and(
        eq(games.status, 'live'),
        category ? arrayContains(games.categories, [category]) : undefined,
      ),
    )
    .orderBy(asc(games.title))

  return c.json({ games: rows, total: rows.length, currency })
})

app.get('/v1/games/:slug', async (c) => {
  const slug = c.req.param('slug')

  const [row] = await db
    .select(gameCardColumns)
    .from(games)
    .leftJoin(providers, eq(games.providerId, providers.id))
    .where(and(eq(games.slug, slug), eq(games.status, 'live')))
    .limit(1)

  if (!row) {
    return c.json({ error: 'not_found', message: `Игра «${slug}» не найдена` }, 404)
  }

  return c.json({ game: row, currency })
})

// ─── Аккаунты и кошелёк ──────────────────────────────────────────────────────────

app.route('/v1/auth', authRoutes)
app.route('/v1/wallet', walletRoutes)

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
