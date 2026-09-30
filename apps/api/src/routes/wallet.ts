import {
  betRequestSchema,
  ledgerQuerySchema,
  payoutRequestSchema,
  rollbackRequestSchema,
} from '@luciferus/protocol/wallet'
import { Hono } from 'hono'
import { parseJson, parseQuery } from '../lib/http'
import { rateLimitByUser } from '../middleware/rate-limit'
import { type AppEnv, requireSession } from '../middleware/session'
import {
  claimReloadBonus,
  getLedger,
  getWalletSummary,
  payOut,
  placeBet,
  rollbackRound,
} from '../services/wallet'

export const walletRoutes = new Hono<AppEnv>()

// Все маршруты кошелька требуют сессию: анонимно менять баланс некому.
walletRoutes.use('*', requireSession)

/** Обзор кошелька: баланс, условия дозаправки и последние операции. */
walletRoutes.get('/', async (c) => {
  const userId = c.get('session').user.id
  const wallet = await getWalletSummary(userId)
  const recent = await getLedger(userId, { limit: 5 })

  return c.json({ wallet, recentEntries: recent.entries })
})

walletRoutes.get('/ledger', async (c) => {
  const query = parseQuery(c, ledgerQuerySchema)
  const page = await getLedger(c.get('session').user.id, {
    limit: query.limit,
    ...(query.cursor ? { cursor: query.cursor } : {}),
  })

  return c.json(page)
})

// Лимиты на операции — защита портала от флуда, а не игрока от самого себя.
walletRoutes.post('/bet', rateLimitByUser('wallet:bet', 120, 60), async (c) => {
  const body = await parseJson(c, betRequestSchema)
  const result = await placeBet({ userId: c.get('session').user.id, ...body })
  return c.json(result)
})

walletRoutes.post('/payout', rateLimitByUser('wallet:payout', 120, 60), async (c) => {
  const body = await parseJson(c, payoutRequestSchema)
  const result = await payOut({ userId: c.get('session').user.id, ...body })
  return c.json(result)
})

walletRoutes.post('/rollback', rateLimitByUser('wallet:rollback', 30, 60), async (c) => {
  const body = await parseJson(c, rollbackRequestSchema)
  const result = await rollbackRound({ userId: c.get('session').user.id, ...body })
  return c.json(result)
})

walletRoutes.post('/reload-bonus', rateLimitByUser('wallet:reload', 10, 3_600), async (c) => {
  const result = await claimReloadBonus(c.get('session').user.id)
  return c.json(result)
})
