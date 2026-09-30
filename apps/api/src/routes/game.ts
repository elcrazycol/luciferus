import {
  betRequestSchema,
  payoutRequestSchema,
  rollbackRequestSchema,
} from '@luciferus/protocol/wallet'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { AppError } from '../lib/errors'
import { parseJson } from '../lib/http'
import { enforceRateLimit } from '../lib/rate-limit'
import { extractSessionToken } from '../middleware/session'
import { authenticateGameRequest, type GameContext } from '../services/game'
import { getWalletSummary, payOut, placeBet, rollbackRound } from '../services/wallet'

export type GameEnv = {
  Variables: {
    game: GameContext
  }
}

export const gameRoutes = new Hono<GameEnv>()

/**
 * CORS здесь максимально широкий — и это осознанно.
 *
 * Данные на этих маршрутах защищает не origin, а игровой токен в заголовке:
 * куки сюда не отправляются вовсе, `credentials` выключен. Сайт, которому токен
 * каким-то образом стал известен, может сделать ровно то же, что и сама игра, —
 * потратить деньги одного игрока в одной игре. Origin-фильтр этого не изменит,
 * зато сломал бы игры, размещённые на нескольких доменах.
 *
 * Именно поэтому игровые маршруты отделены от портальных: у тех проверка origin
 * узкая и куки включены.
 */
gameRoutes.use(
  '*',
  cors({
    origin: '*',
    credentials: false,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    maxAge: 600,
  }),
)

/** Игра не ходит анонимно: токен обязателен на каждом маршруте. */
gameRoutes.use('*', async (c, next) => {
  const token = extractSessionToken(c.req.header('authorization'))
  const context = await authenticateGameRequest(token)
  c.set('game', context)
  await next()
})

/**
 * Игра передаёт свой ключ идемпотентности, но живёт он в общем пространстве имён.
 * Префикс с идентификатором игры не даёт одной игре занять ключ другой.
 */
function scopedKey(gameId: string, key: string | undefined): string | undefined {
  return key ? `game:${gameId}:${key}` : undefined
}

gameRoutes.get('/balance', async (c) => {
  const { userId } = c.get('game')
  const wallet = await getWalletSummary(userId)

  return c.json({ balance: wallet.balance, currency: wallet.currency })
})

gameRoutes.post('/bet', async (c) => {
  const { userId, game } = c.get('game')
  const limit = await enforceRateLimit(`game:bet:${userId}`, 240, 60)
  c.header('X-RateLimit-Remaining', String(limit.remaining))

  const body = await parseJson(c, betRequestSchema)

  // `gameSlug` из тела игнорируется намеренно: играть можно только в ту игру,
  // на которую выдан токен, — иначе лимиты одной игры применялись бы к другой.
  const result = await placeBet({
    userId,
    amount: body.amount,
    roundId: body.roundId,
    gameSlug: game.slug,
    ...(body.meta ? { meta: body.meta } : {}),
    ...(scopedKey(game.id, body.idempotencyKey)
      ? { idempotencyKey: scopedKey(game.id, body.idempotencyKey) }
      : {}),
  })

  return c.json(result)
})

gameRoutes.post('/payout', async (c) => {
  const { userId, game } = c.get('game')
  const limit = await enforceRateLimit(`game:payout:${userId}`, 240, 60)
  c.header('X-RateLimit-Remaining', String(limit.remaining))

  const body = await parseJson(c, payoutRequestSchema)

  const result = await payOut({
    userId,
    amount: body.amount,
    roundId: body.roundId,
    gameSlug: game.slug,
    ...(body.meta ? { meta: body.meta } : {}),
    ...(scopedKey(game.id, body.idempotencyKey)
      ? { idempotencyKey: scopedKey(game.id, body.idempotencyKey) }
      : {}),
  })

  return c.json(result)
})

gameRoutes.post('/rollback', async (c) => {
  const { userId, game } = c.get('game')
  const limit = await enforceRateLimit(`game:rollback:${userId}`, 60, 60)
  c.header('X-RateLimit-Remaining', String(limit.remaining))

  const body = await parseJson(c, rollbackRequestSchema)

  const result = await rollbackRound({
    userId,
    roundId: body.roundId,
    gameSlug: game.slug,
    ...(scopedKey(game.id, body.idempotencyKey)
      ? { idempotencyKey: scopedKey(game.id, body.idempotencyKey) }
      : {}),
  })

  return c.json(result)
})

/** Явная ошибка вместо тихого 404: игра должна понимать, что маршрута нет. */
gameRoutes.all('*', () => {
  throw AppError.notFound('Такого игрового маршрута нет')
})
