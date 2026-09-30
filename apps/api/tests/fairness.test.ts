import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { db } from '@luciferus/db'
import { ledger, seedPairs } from '@luciferus/db/schema'
import { deriveRoundRandom, serverSeedHash, verifyRound } from '@luciferus/fairness'
import { and, eq } from 'drizzle-orm'
import { app } from '../src/index'
import {
  listFairRounds,
  listSeedPairs,
  rotateSeedPair,
  setClientSeed,
  startRound,
  validateClaim,
} from '../src/services/fairness'
import {
  assertDatabaseReachable,
  balanceOf,
  cleanupTestGames,
  cleanupTestUsers,
  createGameFixture,
  createTestGame,
  expectAppError,
} from './helpers'

beforeAll(async () => {
  await assertDatabaseReachable()
  await cleanupTestUsers()
  await cleanupTestGames()
})

afterAll(async () => {
  await cleanupTestGames()
  await cleanupTestUsers()
})

function gamePost(path: string, token: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

function portalPost(path: string, token: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

function portalGet(path: string, token?: string) {
  return app.request(path, { headers: token ? { authorization: `Bearer ${token}` } : {} })
}

describe('выдача случайности раунда', () => {
  test('номер раунда растёт, хэш сида не меняется', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })

    const first = await startRound(fixture.user.id, fixture.game.slug)
    const second = await startRound(fixture.user.id, fixture.game.slug)
    const third = await startRound(fixture.user.id, fixture.game.slug)

    expect([first.nonce, second.nonce, third.nonce]).toEqual([1, 2, 3])
    expect(second.serverSeedHash).toBe(first.serverSeedHash)
    expect(third.clientSeed).toBe(first.clientSeed)

    for (const round of [first, second, third]) {
      expect(round.random).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  test('случайность сходится с раскрытым сидом', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })
    const round = await startRound(fixture.user.id, fixture.game.slug)

    const { revealed } = await rotateSeedPair(fixture.user.id, fixture.game.slug)

    const verification = await verifyRound({
      serverSeed: revealed.serverSeed ?? '',
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      nonce: round.nonce,
      claimedRandom: round.random,
    })

    expect(verification.seedMatchesCommit).toBe(true)
    expect(verification.randomMatches).toBe(true)
  })

  test('игра в режиме client не получает случайность', async () => {
    const fixture = await createGameFixture({ fairMode: 'client' })

    await expectAppError(startRound(fixture.user.id, fixture.game.slug), 'conflict')
  })

  test('пары сидов независимы у разных игроков', async () => {
    const first = await createGameFixture({ fairMode: 'provably-fair' })
    const second = await createGameFixture({ fairMode: 'provably-fair' })

    const firstRound = await startRound(first.user.id, first.game.slug)
    const secondRound = await startRound(second.user.id, second.game.slug)

    expect(firstRound.serverSeedHash).not.toBe(secondRound.serverSeedHash)
    expect(firstRound.clientSeed).not.toBe(secondRound.clientSeed)
  })

  test('одна пара сидов на игрока и игру, а не на игрока целиком', async () => {
    const first = await createGameFixture({ fairMode: 'provably-fair' })
    const second = await createTestGame({ fairMode: 'provably-fair' })

    const firstPair = await startRound(first.user.id, first.game.slug)
    const secondPair = await startRound(first.user.id, second.slug)

    expect(firstPair.serverSeedHash).not.toBe(secondPair.serverSeedHash)
  })
})

describe('проверка заявления игры', () => {
  test('настоящая случайность принимается', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })
    const round = await startRound(fixture.user.id, fixture.game.slug)

    const validated = await validateClaim({
      userId: fixture.user.id,
      game: { ...fixture.game, fairMode: 'provably-fair' } as never,
      claim: {
        nonce: round.nonce,
        serverSeedHash: round.serverSeedHash,
        random: round.random,
      },
    })

    expect(validated.clientSeed).toBe(round.clientSeed)
  })

  /**
   * Центральная проверка фазы: игра подсунула своё число. Сервер знает свой сид,
   * поэтому видит подмену и отказывает — до того, как деньги ушли.
   */
  test('подсунутая игра случайность отклоняется', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })
    const round = await startRound(fixture.user.id, fixture.game.slug)

    await expectAppError(
      validateClaim({
        userId: fixture.user.id,
        game: { ...fixture.game, fairMode: 'provably-fair' } as never,
        claim: {
          nonce: round.nonce,
          serverSeedHash: round.serverSeedHash,
          random: 'a'.repeat(64),
        },
      }),
      'conflict',
    )
  })

  test('чужой хэш сида отклоняется', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })
    await startRound(fixture.user.id, fixture.game.slug)

    await expectAppError(
      validateClaim({
        userId: fixture.user.id,
        game: { ...fixture.game, fairMode: 'provably-fair' } as never,
        claim: { nonce: 1, serverSeedHash: 'b'.repeat(64), random: 'c'.repeat(64) },
      }),
      'conflict',
    )
  })

  test('невыданный номер раунда отклоняется', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })
    const round = await startRound(fixture.user.id, fixture.game.slug)

    await expectAppError(
      validateClaim({
        userId: fixture.user.id,
        game: { ...fixture.game, fairMode: 'provably-fair' } as never,
        claim: {
          nonce: round.nonce + 100,
          serverSeedHash: round.serverSeedHash,
          random: round.random,
        },
      }),
      'conflict',
    )
  })

  test('раскрытый старый сид остаётся валидным для своих раундов', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })
    const round = await startRound(fixture.user.id, fixture.game.slug)

    await rotateSeedPair(fixture.user.id, fixture.game.slug)

    // Игра доигрывает раунд, начатый до смены сида: это допустимо, номер уже выдан.
    const validated = await validateClaim({
      userId: fixture.user.id,
      game: { ...fixture.game, fairMode: 'provably-fair' } as never,
      claim: { nonce: round.nonce, serverSeedHash: round.serverSeedHash, random: round.random },
    })

    expect(validated.clientSeed).toBe(round.clientSeed)
  })
})

describe('ставка в проверяемом режиме', () => {
  test('без данных раунда отклоняется', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })

    const response = await gamePost('/v1/game/bet', fixture.gameToken, {
      amount: 10,
      roundId: 'r-1',
    })

    expect(response.status).toBe(409)

    const body = (await response.json()) as { message: string }
    expect(body.message).toContain('provably-fair')
    expect(await balanceOf(fixture.user.id)).toBe('250.00')
  })

  test('с настоящей случайностью проходит и пишется в журнал', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })
    const round = await startRound(fixture.user.id, fixture.game.slug)

    const response = await gamePost('/v1/game/bet', fixture.gameToken, {
      amount: 10,
      roundId: 'r-fair-1',
      fair: { nonce: round.nonce, serverSeedHash: round.serverSeedHash, random: round.random },
    })

    expect(response.status).toBe(200)

    const entries = await db.select().from(ledger).where(eq(ledger.userId, fixture.user.id))
    const bet = entries.find((entry) => entry.type === 'bet')
    const fair = (bet?.meta as { fair?: Record<string, unknown> } | null)?.fair

    expect(fair?.nonce).toBe(round.nonce)
    expect(fair?.random).toBe(round.random)
    expect(fair?.clientSeed).toBe(round.clientSeed)
  })

  test('подсунутая случайность не проходит и деньги не списываются', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })
    const round = await startRound(fixture.user.id, fixture.game.slug)

    const response = await gamePost('/v1/game/bet', fixture.gameToken, {
      amount: 10,
      roundId: 'r-cheat',
      fair: { nonce: round.nonce, serverSeedHash: round.serverSeedHash, random: 'f'.repeat(64) },
    })

    expect(response.status).toBe(409)
    expect(await balanceOf(fixture.user.id)).toBe('250.00')
  })

  /** Ключевое: одним номером раунда нельзя сыграть дважды. */
  test('повтор номера раунда другой ставкой отклоняется', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })
    const round = await startRound(fixture.user.id, fixture.game.slug)

    const payload = {
      amount: 10,
      fair: { nonce: round.nonce, serverSeedHash: round.serverSeedHash, random: round.random },
    }

    expect(
      (await gamePost('/v1/game/bet', fixture.gameToken, { ...payload, roundId: 'r-a' })).status,
    ).toBe(200)

    const second = await gamePost('/v1/game/bet', fixture.gameToken, {
      ...payload,
      roundId: 'r-b',
    })

    expect(second.status).toBe(409)
    expect(await balanceOf(fixture.user.id)).toBe('240.00')
  })

  test('повтор того же раунда идемпотентен, а не отклоняется', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })
    const round = await startRound(fixture.user.id, fixture.game.slug)

    const payload = {
      amount: 10,
      roundId: 'r-same',
      fair: { nonce: round.nonce, serverSeedHash: round.serverSeedHash, random: round.random },
    }

    const first = (await (await gamePost('/v1/game/bet', fixture.gameToken, payload)).json()) as {
      idempotent: boolean
    }
    const second = (await (await gamePost('/v1/game/bet', fixture.gameToken, payload)).json()) as {
      idempotent: boolean
    }

    expect(first.idempotent).toBe(false)
    expect(second.idempotent).toBe(true)
    expect(await balanceOf(fixture.user.id)).toBe('240.00')
  })

  test('игра в режиме client не обязана присылать случайность', async () => {
    const fixture = await createGameFixture({ fairMode: 'client' })

    const response = await gamePost('/v1/game/bet', fixture.gameToken, {
      amount: 10,
      roundId: 'r-client',
    })

    expect(response.status).toBe(200)
  })

  test('выплата не несёт данных честности: они уже на ставке', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })
    const round = await startRound(fixture.user.id, fixture.game.slug)

    await gamePost('/v1/game/bet', fixture.gameToken, {
      amount: 10,
      roundId: 'r-payout',
      fair: { nonce: round.nonce, serverSeedHash: round.serverSeedHash, random: round.random },
    })

    const payout = await gamePost('/v1/game/payout', fixture.gameToken, {
      amount: 50,
      roundId: 'r-payout',
    })

    expect(payout.status).toBe(200)
    expect(await balanceOf(fixture.user.id)).toBe('290.00')

    const entries = await db.select().from(ledger).where(eq(ledger.userId, fixture.user.id))
    const payoutEntry = entries.find((entry) => entry.type === 'payout')
    const fair = (payoutEntry?.meta as { fair?: unknown } | null)?.fair

    expect(fair).toBeUndefined()
  })
})

describe('маршрут выдачи случайности', () => {
  test('игра запрашивает раунд через API', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })

    const response = await gamePost('/v1/game/fair/next', fixture.gameToken, {})

    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      nonce: number
      random: string
      serverSeedHash: string
    }
    expect(body.nonce).toBe(1)
    expect(body.random).toMatch(/^[0-9a-f]{64}$/)
    expect(body.serverSeedHash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('игра в режиме client получает отказ', async () => {
    const fixture = await createGameFixture({ fairMode: 'client' })

    const response = await gamePost('/v1/game/fair/next', fixture.gameToken, {})
    expect(response.status).toBe(409)
  })

  test('без игрового токена — 401', async () => {
    const response = await app.request('/v1/game/fair/next', { method: 'POST' })
    expect(response.status).toBe(401)
  })
})

describe('управление парами сидов', () => {
  test('список отдаёт активную пару без серверного сида', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })
    await startRound(fixture.user.id, fixture.game.slug)

    const response = await portalGet(
      `/v1/fair/seeds?gameSlug=${fixture.game.slug}`,
      fixture.session.token,
    )

    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      active: { serverSeed: string | null; serverSeedHash: string; nonce: number } | null
      revealed: unknown[]
    }

    expect(body.active?.nonce).toBe(1)
    expect(body.active?.serverSeedHash).toMatch(/^[0-9a-f]{64}$/)
    // Скрытый сид не уезжает наружу ни при каких условиях.
    expect(body.active?.serverSeed).toBeNull()
    expect(body.revealed).toHaveLength(0)
  })

  test('ротация раскрывает прежний сид и начинает нумерацию заново', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })
    const round = await startRound(fixture.user.id, fixture.game.slug)

    const response = await portalPost('/v1/fair/rotate', fixture.session.token, {
      gameSlug: fixture.game.slug,
    })

    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      revealed: { serverSeed: string | null; serverSeedHash: string }
      current: { nonce: number; serverSeedHash: string }
    }

    expect(body.revealed.serverSeed).not.toBeNull()
    expect(body.current.nonce).toBe(0)
    expect(body.current.serverSeedHash).not.toBe(round.serverSeedHash)

    // Раскрытый сид действительно объясняет прежний коммит.
    const hash = await serverSeedHash(body.revealed.serverSeed ?? '')
    expect(hash).toBe(body.revealed.serverSeedHash)
  })

  test('клиентский сид можно задать свой', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })
    await startRound(fixture.user.id, fixture.game.slug)

    const pair = await setClientSeed(fixture.user.id, fixture.game.slug, 'мой-сид')

    expect(pair.clientSeed).toBe('мой-сид')

    // И следующий раунд считается уже с новым сидом.
    const next = await startRound(fixture.user.id, fixture.game.slug)
    expect(next.clientSeed).toBe('мой-сид')
  })

  test('игра в режиме client сиды не выдаёт', async () => {
    const fixture = await createGameFixture({ fairMode: 'client' })

    const response = await portalPost('/v1/fair/rotate', fixture.session.token, {
      gameSlug: fixture.game.slug,
    })

    expect(response.status).toBe(409)
  })

  test('без сессии портала — 401', async () => {
    expect((await portalGet('/v1/fair/seeds')).status).toBe(401)
    expect((await portalPost('/v1/fair/rotate', '', { gameSlug: 'lucky-7s' })).status).toBe(401)
  })

  test('одна активная пара: повторный вызов не создаёт вторую', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })

    await startRound(fixture.user.id, fixture.game.slug)
    await startRound(fixture.user.id, fixture.game.slug)

    const active = await db
      .select()
      .from(seedPairs)
      .where(and(eq(seedPairs.userId, fixture.user.id), eq(seedPairs.gameId, fixture.game.id)))

    expect(active).toHaveLength(1)
  })
})

describe('ручная проверка раунда', () => {
  test('проверка доступна любому: это публичная арифметика', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })
    const round = await startRound(fixture.user.id, fixture.game.slug)
    const { revealed } = await rotateSeedPair(fixture.user.id, fixture.game.slug)

    const response = await portalPost('/v1/fair/verify', fixture.session.token, {
      serverSeed: revealed.serverSeed ?? '',
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      nonce: round.nonce,
      random: round.random,
    })

    expect(response.status).toBe(200)

    const body = (await response.json()) as { verified: boolean }
    expect(body.verified).toBe(true)
  })

  test('подмена случайности видна в ответе', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })
    const round = await startRound(fixture.user.id, fixture.game.slug)
    const { revealed } = await rotateSeedPair(fixture.user.id, fixture.game.slug)

    const response = await portalPost('/v1/fair/verify', fixture.session.token, {
      serverSeed: revealed.serverSeed,
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      nonce: round.nonce,
      random: 'a'.repeat(64),
    })

    const body = (await response.json()) as {
      verified: boolean
      randomMatches: boolean
      computedRandom: string
    }

    expect(body.verified).toBe(false)
    expect(body.randomMatches).toBe(false)
    expect(body.computedRandom).toBe(round.random)
  })

  test('некорректный ввод отсекается валидацией', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })

    const bad = await portalPost('/v1/fair/verify', fixture.session.token, {
      serverSeed: '',
      serverSeedHash: 'коротко',
      clientSeed: 'c',
      nonce: 0,
      random: 'нет',
    })

    expect(bad.status).toBe(400)
  })
})

describe('раунды для страницы проверки', () => {
  test('отдаёт сыгранные раунды с данными честности', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })

    for (let index = 0; index < 3; index += 1) {
      const round = await startRound(fixture.user.id, fixture.game.slug)
      await gamePost('/v1/game/bet', fixture.gameToken, {
        amount: 5,
        roundId: `r-${index}`,
        fair: { nonce: round.nonce, serverSeedHash: round.serverSeedHash, random: round.random },
      })
    }

    const result = await listFairRounds(fixture.user.id, fixture.game.slug)

    expect(result.rounds).toHaveLength(3)
    expect(result.rounds.every((round) => round.random !== null)).toBe(true)
    expect(result.rounds.every((round) => round.nonce !== null)).toBe(true)
    // Пары ещё не раскрыты — проверить раунды пока нельзя.
    expect(result.rounds.every((round) => round.verifiable === false)).toBe(true)
  })

  test('после ротации прежние раунды становятся проверяемыми', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })
    const round = await startRound(fixture.user.id, fixture.game.slug)

    await gamePost('/v1/game/bet', fixture.gameToken, {
      amount: 5,
      roundId: 'r-old',
      fair: { nonce: round.nonce, serverSeedHash: round.serverSeedHash, random: round.random },
    })

    await rotateSeedPair(fixture.user.id, fixture.game.slug)

    const result = await listFairRounds(fixture.user.id, fixture.game.slug)
    expect(result.rounds[0]?.verifiable).toBe(true)
  })

  test('раунды чужого игрока не видны', async () => {
    const first = await createGameFixture({ fairMode: 'provably-fair' })
    const second = await createGameFixture({ fairMode: 'provably-fair' })

    const round = await startRound(first.user.id, first.game.slug)
    await gamePost('/v1/game/bet', first.gameToken, {
      amount: 5,
      roundId: 'r-private',
      fair: { nonce: round.nonce, serverSeedHash: round.serverSeedHash, random: round.random },
    })

    const result = await listFairRounds(second.user.id, second.game.slug)
    expect(result.rounds).toHaveLength(0)
  })

  test('раунд в режиме client в списке не появляется: проверять нечего', async () => {
    const fixture = await createGameFixture({ fairMode: 'client' })
    await gamePost('/v1/game/bet', fixture.gameToken, { amount: 5, roundId: 'r-client' })

    const result = await listFairRounds(fixture.user.id, fixture.game.slug)
    expect(result.rounds).toHaveLength(0)
  })
})

describe('согласованность вывода случайности', () => {
  test('служба и пакет честности считают одинаково', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })
    const round = await startRound(fixture.user.id, fixture.game.slug)

    const { revealed } = await rotateSeedPair(fixture.user.id, fixture.game.slug)

    const manual = await deriveRoundRandom({
      serverSeed: revealed.serverSeed ?? '',
      clientSeed: round.clientSeed,
      nonce: round.nonce,
    })

    expect(manual).toBe(round.random)
  })

  test('пары переживают перезапрос списка', async () => {
    const fixture = await createGameFixture({ fairMode: 'provably-fair' })
    await startRound(fixture.user.id, fixture.game.slug)

    const first = await listSeedPairs(fixture.user.id, fixture.game.slug)
    const second = await listSeedPairs(fixture.user.id, fixture.game.slug)

    expect(first.active?.serverSeedHash).toBe(second.active?.serverSeedHash)
  })
})
