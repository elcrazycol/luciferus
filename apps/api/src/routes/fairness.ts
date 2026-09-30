import {
  type FairRoundsResponse,
  rotateSeedSchema,
  type SeedPairDto,
  type SeedPairsResponse,
  setClientSeedSchema,
  type VerifyRoundResponse,
  verifyRoundSchema,
} from '@luciferus/protocol/fairness'
import { Hono } from 'hono'
import { z } from 'zod'
import { parseJson, parseQuery } from '../lib/http'
import { rateLimitByUser } from '../middleware/rate-limit'
import { type AppEnv, requireSession } from '../middleware/session'
import {
  listFairRounds,
  listSeedPairs,
  type RotateResult,
  rotateSeedPair,
  setClientSeed,
  verifyRound,
} from '../services/fairness'

export const fairnessRoutes = new Hono<AppEnv>()

// Всё, что здесь есть, — про конкретного игрока, поэтому только с сессией.
fairnessRoutes.use('*', requireSession)

const seedsQuerySchema = z.object({
  gameSlug: z.string().trim().min(1).max(64).optional(),
})

fairnessRoutes.get('/seeds', async (c) => {
  const query = parseQuery(c, seedsQuerySchema)
  const pairs: SeedPairsResponse = await listSeedPairs(c.get('session').user.id, query.gameSlug)

  return c.json(pairs)
})

/**
 * Раскрытие текущей пары и создание новой.
 *
 * После этого шага серверный сид становится публичным навсегда — именно он и
 * позволяет перепроверить все сыгранные раунды.
 */
fairnessRoutes.post('/rotate', rateLimitByUser('fair:rotate', 30, 3_600), async (c) => {
  const body = await parseJson(c, rotateSeedSchema)
  const result: RotateResult = await rotateSeedPair(
    c.get('session').user.id,
    body.gameSlug,
    body.clientSeed,
  )

  return c.json(result)
})

/** Смена клиентского сида. Сервер обязан использовать новый — это проверяемо. */
fairnessRoutes.post('/client-seed', rateLimitByUser('fair:client-seed', 60, 3_600), async (c) => {
  const body = await parseJson(c, setClientSeedSchema)
  const pair: SeedPairDto = await setClientSeed(
    c.get('session').user.id,
    body.gameSlug,
    body.clientSeed,
  )

  return c.json({ pair })
})

/**
 * Ручная проверка раунда.
 *
 * Работает и для чужих раундов: достаточно четырёх значений. Поэтому здесь не
 * проверяется, что пара принадлежит игроку — проверять имеет право кто угодно.
 */
fairnessRoutes.post('/verify', rateLimitByUser('fair:verify', 120, 3_600), async (c) => {
  const body = await parseJson(c, verifyRoundSchema)
  const result: VerifyRoundResponse = await verifyRound(body)

  return c.json(result)
})

const roundsQuerySchema = z.object({
  gameSlug: z.string().trim().min(1).max(64),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

fairnessRoutes.get('/rounds', async (c) => {
  const query = parseQuery(c, roundsQuerySchema)
  const rounds: FairRoundsResponse = await listFairRounds(
    c.get('session').user.id,
    query.gameSlug,
    query.limit,
  )

  return c.json(rounds)
})
