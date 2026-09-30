import {
  betRequestSchema,
  ledgerQuerySchema,
  payoutRequestSchema,
  rollbackRequestSchema,
} from '@luciferus/protocol/wallet'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { subscribeBalance } from '../lib/events'
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

/**
 * Поток изменений баланса для интерфейса.
 *
 * Server-Sent Events, а не WebSocket: данные идут только в одну сторону, а
 * EventSource сам переподключается после обрыва — для «обнови цифру» этого
 * достаточно и заметно проще.
 *
 * Первым сообщением уходит текущий баланс: подписчик может открыть поток в любой
 * момент и должен сразу получить актуальное значение, а не ждать следующей ставки.
 */
walletRoutes.get('/stream', async (c) => {
  const userId = c.get('session').user.id
  const wallet = await getWalletSummary(userId)

  return streamSSE(c, async (stream) => {
    let closed = false

    const send = async (event: string, data: unknown): Promise<void> => {
      if (closed) return

      try {
        await stream.writeSSE({ event, data: JSON.stringify(data) })
      } catch {
        // Клиент отключился — выходим из цикла ниже.
        closed = true
      }
    }

    await send('balance', {
      balance: wallet.balance,
      delta: '0.00',
      reason: 'initial',
      at: new Date().toISOString(),
    })

    const unsubscribe = subscribeBalance(userId, (event) => {
      void send('balance', event)
    })

    stream.onAbort(() => {
      closed = true
      unsubscribe()
    })

    // Сердцебиение: без него прокси и браузеры рвут «молчащий» поток.
    while (!closed) {
      try {
        await stream.sleep(15_000)
      } catch {
        closed = true
        break
      }

      await send('ping', {})
    }

    unsubscribe()
  })
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
