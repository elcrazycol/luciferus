import { GAME_STATUSES, type GameStatus } from '@luciferus/protocol/game'
import { Hono } from 'hono'
import { z } from 'zod'
import { parseJson, parseQuery } from '../lib/http'
import { rateLimitByUser } from '../middleware/rate-limit'
import { type AppEnv, requireAdmin, requireSession } from '../middleware/session'
import { countByStatus, listModerationQueue, moderateGame } from '../services/submission'
import { adjustBalance } from '../services/wallet'

export const adminRoutes = new Hono<AppEnv>()

// Админка целиком под двумя проверками: сначала сессия, потом роль.
adminRoutes.use('*', requireSession, requireAdmin)

const queueQuerySchema = z.object({
  status: z.enum(GAME_STATUSES).default('pending'),
})

const moderationSchema = z.object({
  decision: z.enum(['approve', 'reject', 'disable']),
  note: z.string().trim().max(300).optional(),
})

const balanceSchema = z.object({
  /** Знаковая сумма: положительная — начислить, отрицательная — списать. */
  amount: z.number().refine((value) => value !== 0, 'Сумма не может быть нулевой'),
  note: z.string().trim().min(3, 'Напишите причину — она останется в журнале').max(300),
})

adminRoutes.get('/overview', async (c) => {
  const [pending, live, disabled, drafts] = await Promise.all([
    countByStatus('pending'),
    countByStatus('live'),
    countByStatus('disabled'),
    countByStatus('draft'),
  ])

  return c.json({ games: { pending, live, disabled, drafts } })
})

adminRoutes.get('/games', async (c) => {
  const { status } = parseQuery(c, queueQuerySchema)
  const games = await listModerationQueue(status as GameStatus)

  return c.json({ games, total: games.length, status })
})

adminRoutes.post(
  '/games/:slug/moderate',
  rateLimitByUser('admin:moderate', 120, 3_600),
  async (c) => {
    const body = await parseJson(c, moderationSchema)
    const game = await moderateGame(c.req.param('slug'), body.decision, body.note ?? null)

    return c.json({ game })
  },
)

/**
 * Ручная правка баланса игрока.
 *
 * Идёт обычным путём через леджер: у любой корректировки есть автор и причина,
 * и она видна игроку в истории кошелька. Тихая правка `wallets` запрещена.
 */
adminRoutes.post(
  '/users/:userId/balance',
  rateLimitByUser('admin:balance', 60, 3_600),
  async (c) => {
    const body = await parseJson(c, balanceSchema)

    const result = await adjustBalance({
      userId: c.req.param('userId'),
      amount: body.amount,
      note: body.note,
      adminId: c.get('session').user.id,
    })

    return c.json(result)
  },
)
