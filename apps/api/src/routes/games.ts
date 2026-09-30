import { currency } from '@luciferus/config/currency'
import { db } from '@luciferus/db'
import { games, providers } from '@luciferus/db/schema'
import { and, arrayContains, asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AppEnv, requireSession } from '../middleware/session'
import { createGameLaunch } from '../services/game'

export const gamesRoutes = new Hono<AppEnv>()

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
  // Публично: это origin, который игра сама объявила. Портал показывает
  // кнопку «Играть» только тем играм, у которых он есть — остальные не запустятся.
  allowedOrigins: games.allowedOrigins,
  isStub: games.isStub,
  providerSlug: providers.slug,
  providerName: providers.name,
  providerVerified: providers.verified,
}

/** Публичный каталог: без сессии, только опубликованные игры. */
gamesRoutes.get('/', async (c) => {
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

gamesRoutes.get('/:slug', async (c) => {
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

/**
 * Всё, что нужно, чтобы открыть игру: адрес iframe, игровой токен, баланс и лимиты.
 *
 * Требует сессию портала — игру открывает игрок, а не анонимный посетитель.
 * Токен живёт ограниченное время и действует только для этой игры.
 */
gamesRoutes.get('/:slug/launch', requireSession, async (c) => {
  const launch = await createGameLaunch(c.req.param('slug'), c.get('session'))
  return c.json(launch)
})
