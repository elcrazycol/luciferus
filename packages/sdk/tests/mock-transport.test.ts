import { describe, expect, test } from 'bun:test'
import type { SdkErrorCode } from '@luciferus/protocol/embed-constants'
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

function createTransport(storage: StorageLike = createMemoryStorage()) {
  return createMockTransport({
    storage,
    startingBalance: 250,
    currency: 'C$',
    limits: { minBet: 0.1, maxBet: 100, maxWin: 5000 },
  })
}

async function expectCode(promise: Promise<unknown>, code: SdkErrorCode) {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(CasinoError)
    expect((error as CasinoError).code).toBe(code)
    return
  }

  throw new Error(`Ожидалась ошибка «${code}», но операция прошла`)
}

describe('мок-кошелёк: старт', () => {
  test('начинает со стартового бонуса', async () => {
    const session = await createTransport().ready({
      onBalance() {},
      onError() {},
    })

    expect(session.balance).toBe('250.00')
    expect(session.currency).toBe('C$')
    expect(session.player?.id).toBe('mock-player')
  })
})

describe('мок-кошелёк: ставки', () => {
  test('списывает и возвращает знаковую сумму', async () => {
    const transport = createTransport()

    const result = await transport.bet({ amount: 10, roundId: 'r1' })
    expect(result.balance).toBe('240.00')
    expect(result.amount).toBe('-10.00')
    expect(result.idempotent).toBe(false)
  })

  test('повтор раунда не списывает дважды', async () => {
    const transport = createTransport()

    await transport.bet({ amount: 10, roundId: 'r1' })
    const repeat = await transport.bet({ amount: 10, roundId: 'r1' })

    expect(repeat.idempotent).toBe(true)
    expect(repeat.balance).toBe('240.00')
  })

  test('не уходит в минус', async () => {
    const transport = createTransport()

    await transport.bet({ amount: 100, roundId: 'a' })
    await transport.bet({ amount: 100, roundId: 'b' })

    await expectCode(transport.bet({ amount: 100, roundId: 'c' }), 'insufficient_funds')
    expect((await transport.refresh()).balance).toBe('50.00')
  })

  test('соблюдает минимальную и максимальную ставку', async () => {
    const transport = createTransport()

    await expectCode(transport.bet({ amount: 0.01, roundId: 'a' }), 'limit_exceeded')
    await expectCode(transport.bet({ amount: 101, roundId: 'b' }), 'limit_exceeded')
    await expectCode(transport.bet({ amount: -5, roundId: 'c' }), 'bad_request')
    await expectCode(transport.bet({ amount: Number.NaN, roundId: 'd' }), 'bad_request')
  })
})

describe('мок-кошелёк: выигрыши и отмена', () => {
  test('выигрыш невозможен без ставки', async () => {
    const transport = createTransport()
    await expectCode(transport.payout({ amount: 50, roundId: 'нет' }), 'conflict')
  })

  test('выигрыш начисляется и не удваивается', async () => {
    const transport = createTransport()

    await transport.bet({ amount: 10, roundId: 'r1' })
    const first = await transport.payout({ amount: 50, roundId: 'r1' })
    const repeat = await transport.payout({ amount: 50, roundId: 'r1' })

    expect(first.balance).toBe('290.00')
    expect(repeat.idempotent).toBe(true)
    expect(repeat.balance).toBe('290.00')
  })

  test('выигрыш выше предела отклоняется', async () => {
    const transport = createTransport()

    await transport.bet({ amount: 10, roundId: 'r1' })
    await expectCode(transport.payout({ amount: 5001, roundId: 'r1' }), 'limit_exceeded')
  })

  test('отмена возвращает ставку', async () => {
    const transport = createTransport()

    await transport.bet({ amount: 25, roundId: 'r1' })
    const result = await transport.rollback({ roundId: 'r1' })

    expect(result.balance).toBe('250.00')
    expect(result.amount).toBe('25.00')
  })

  test('отмена после выигрыша запрещена', async () => {
    const transport = createTransport()

    await transport.bet({ amount: 25, roundId: 'r1' })
    await transport.payout({ amount: 50, roundId: 'r1' })

    await expectCode(transport.rollback({ roundId: 'r1' }), 'conflict')
  })

  test('повторная отмена идемпотентна', async () => {
    const transport = createTransport()

    await transport.bet({ amount: 25, roundId: 'r1' })
    await transport.rollback({ roundId: 'r1' })
    const repeat = await transport.rollback({ roundId: 'r1' })

    expect(repeat.idempotent).toBe(true)
    expect(repeat.balance).toBe('250.00')
  })

  test('отмена без ставки нечего отменять', async () => {
    const transport = createTransport()
    await expectCode(transport.rollback({ roundId: 'пусто' }), 'conflict')
  })
})

describe('мок-кошелёк: состояние между перезагрузками', () => {
  test('баланс переживает пересоздание транспорта', async () => {
    const storage = createMemoryStorage()

    const first = createTransport(storage)
    await first.bet({ amount: 100, roundId: 'r1' })

    const second = createTransport(storage)
    expect((await second.refresh()).balance).toBe('150.00')

    // И раунд всё ещё считается применённым — иначе перезагрузка страницы
    // позволяла бы крутить один раунд бесконечно.
    const repeat = await second.bet({ amount: 100, roundId: 'r1' })
    expect(repeat.idempotent).toBe(true)
    expect(repeat.balance).toBe('150.00')
  })

  test('испорченное хранилище не ломает игру', async () => {
    const storage = createMemoryStorage()
    storage.setItem('luciferus:mock-wallet:v1', '{это не json')

    const transport = createTransport(storage)
    expect((await transport.refresh()).balance).toBe('250.00')
  })
})

describe('мок-кошелёк: управление для отладки', () => {
  test('начисление и сброс', async () => {
    const transport = createTransport()

    expect(transport.controls.deposit(1000)).toBe('1250.00')
    expect(transport.controls.reset()).toBe('250.00')
    expect((await transport.refresh()).balance).toBe('250.00')
  })
})
