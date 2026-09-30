import {
  type GameCard,
  gameListQuerySchema,
  gameSubmissionSchema,
  gameUpdateSchema,
} from '@luciferus/protocol/game'
import { Hono } from 'hono'
import { parseJson, parseQuery } from '../lib/http'
import { rateLimitByIp, rateLimitByUser } from '../middleware/rate-limit'
import { type AppEnv, requireSession } from '../middleware/session'
import { findGameCard, listGames } from '../services/catalog'
import { createGameLaunch } from '../services/game'
import { listOwnGames, requireOwnGame, submitGame, updateGame } from '../services/submission'

export const gamesRoutes = new Hono<AppEnv>()

/**
 * Публичный каталог: без сессии, только опубликованные игры.
 * Фильтры, поиск, сортировка и грани для панели фильтров — всё в одном ответе.
 */
gamesRoutes.get('/', rateLimitByIp('games:list', 240, 60), async (c) => {
  const query = parseQuery(c, gameListQuerySchema)
  return c.json(await listGames(query))
})

/**
 * Свои игры. Зарегистрирован ДО `/:slug` — иначе Hono принял бы «mine» за слаг игры.
 */
gamesRoutes.get('/mine', requireSession, async (c) => {
  const games = await listOwnGames(c.get('session').user.id)
  return c.json({ games, total: games.length })
})

/** Карточка одной игры. Черновики и отключённые видны только владельцу и админу. */
gamesRoutes.get('/:slug', async (c) => {
  const slug = c.req.param('slug')
  const card = await findGameCard(slug)

  if (!card) {
    return c.json({ error: 'not_found', message: `Игра «${slug}» не найдена` }, 404)
  }

  return c.json({ game: card })
})

/**
 * Всё, что нужно, чтобы открыть игру: адрес iframe, игровой токен, баланс и лимиты.
 *
 * Требует сессию портала — игру открывает игрок, а не анонимный посетитель.
 */
gamesRoutes.get('/:slug/launch', requireSession, async (c) => {
  const launch = await createGameLaunch(c.req.param('slug'), c.get('session'))
  return c.json(launch)
})

/** Заявка на публикацию. */
gamesRoutes.post('/', requireSession, rateLimitByUser('games:submit', 20, 3_600), async (c) => {
  const body = await parseJson(c, gameSubmissionSchema)
  const game = await submitGame(c.get('session').user.id, body)

  return c.json({ game }, 201)
})

/** Обновление игры. Смена адреса или origin'ов возвращает игру на модерацию. */
gamesRoutes.patch(
  '/:slug',
  requireSession,
  rateLimitByUser('games:update', 60, 3_600),
  async (c) => {
    const session = c.get('session')
    const body = await parseJson(c, gameUpdateSchema)
    const game = await updateGame(c.req.param('slug'), session.user.id, session.user.role, body)

    return c.json({ game })
  },
)

/** Проверка «это моя игра?» для страницы разработчика. */
gamesRoutes.get('/:slug/mine', requireSession, async (c) => {
  const session = c.get('session')
  const game: GameCard = await requireOwnGame(
    c.req.param('slug'),
    session.user.id,
    session.user.role,
  )

  return c.json({ game })
})
