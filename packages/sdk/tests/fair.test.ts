import { describe, expect, test } from 'bun:test'
import { verifyRound } from '@luciferus/fairness'
import { createCasino } from '../src/core'
import { CasinoError } from '../src/errors'
import { createMockTransport } from '../src/transports/mock'
import type { StorageLike } from '../src/types'

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>()

  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
  }
}

function createStack(storage: StorageLike = createMemoryStorage()) {
  const mockTransport = createMockTransport({
    storage,
    startingBalance: 250,
    currency: 'C$',
    limits: { minBet: 0.1, maxBet: 100, maxWin: 5000 },
  })

  const casino = createCasino({
    portalTransport: null,
    mockTransport,
    randomId: () => 'r-fixed',
  })

  return { casino, mockTransport }
}

describe('случайность раунда в мок-режиме', () => {
  /**
   * Главная проверка мок-режима: он не «делает вид», а действительно считает
   * commit-reveal. Если бы мок выдавал случайные числа из воздуха, игра
   * работала бы локально и расходилась с порталом.
   */
  test('выданная случайность сходится с хэшем сида и клиентским сидом', async () => {
    const { casino, mockTransport } = createStack()
    await casino.ready()

    const round = await casino.fairStart('round-1')

    const verification = await verifyRound({
      serverSeed: (await mockTransport.controls.seeds()).serverSeed,
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      nonce: round.nonce,
      claimedRandom: round.random,
    })

    expect(verification.seedMatchesCommit).toBe(true)
    expect(verification.randomMatches).toBe(true)
  })

  test('номер раунда растёт и не повторяется', async () => {
    const { casino } = createStack()
    await casino.ready()

    const nonces = []
    for (let index = 0; index < 5; index += 1) {
      nonces.push((await casino.fairStart()).nonce)
    }

    expect(nonces).toEqual([1, 2, 3, 4, 5])
  })

  test('разные раунды дают разную случайность', async () => {
    const { casino } = createStack()
    await casino.ready()

    const first = await casino.fairStart()
    const second = await casino.fairStart()

    expect(first.random).not.toBe(second.random)
    expect(first.random).toMatch(/^[0-9a-f]{64}$/)
  })

  test('смена пары сидов раскрывает прежний сид и начинает нумерацию заново', async () => {
    const { casino, mockTransport } = createStack()
    await casino.ready()

    const before = await casino.fairStart()
    const { revealed, serverSeedHash } = await mockTransport.controls.rotate()

    expect(serverSeedHash).toBe(before.serverSeedHash)

    const after = await casino.fairStart()
    expect(after.nonce).toBe(1)
    expect(after.serverSeedHash).not.toBe(before.serverSeedHash)

    // Раскрытый сид действительно объясняет прежний хэш.
    const verification = await verifyRound({
      serverSeed: revealed,
      serverSeedHash: before.serverSeedHash,
      clientSeed: before.clientSeed,
      nonce: before.nonce,
      claimedRandom: before.random,
    })

    // Пакет честности отдаёт две независимые проверки; итоговый флаг собирает API.
    expect(verification.seedMatchesCommit).toBe(true)
    expect(verification.randomMatches).toBe(true)
  })
})

describe('проверяемый режим в ядре SDK', () => {
  test('ставка без случайности раунда отклоняется до запроса', async () => {
    const { casino } = createStack()
    await casino.ready()

    expect(casino.fairMode).toBe('provably-fair')

    try {
      await casino.bet(10, { roundId: 'r-1' })
      throw new Error('ожидалась ошибка')
    } catch (error) {
      expect(error).toBeInstanceOf(CasinoError)
      expect((error as CasinoError).code).toBe('bad_request')
      expect((error as CasinoError).message).toContain('fair.start')
    }
  })

  test('ставка со случайностью проходит', async () => {
    const { casino } = createStack()
    await casino.ready()

    const round = await casino.fairStart('r-2')
    const result = await casino.bet(10, { roundId: round.roundId, fair: round })

    expect(result.balance).toBe(240)
  })

  test('выигрыш не требует случайности: он привязан к раунду', async () => {
    const { casino } = createStack()
    await casino.ready()

    const round = await casino.fairStart('r-3')
    await casino.bet(10, { roundId: round.roundId, fair: round })

    const payout = await casino.payout(50, { roundId: round.roundId })
    expect(payout.balance).toBe(290)
  })

  test('режим честности попадает в снимок состояния', async () => {
    const { casino } = createStack()
    const snapshot = await casino.ready()

    expect(snapshot.fairMode).toBe('provably-fair')
    expect(casino.fairMode).toBe('provably-fair')
  })
})
