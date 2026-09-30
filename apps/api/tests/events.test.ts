import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  activeSubscriptions,
  type BalanceEvent,
  closeEventSubscriber,
  publishBalance,
  subscribeBalance,
} from '../src/lib/events'
import { closeRedis, pingRedis } from '../src/lib/redis'

/**
 * Слой событий — то, на чём держится мгновенное обновление баланса.
 *
 * Проверяем вживую через Redis, а не заглушками: интерес здесь именно в том,
 * доезжает ли сообщение от публикации до подписчика, и не ломается ли подписка,
 * когда у игрока открыто несколько вкладок.
 */

function event(balance: string, reason = 'bet'): BalanceEvent {
  return { balance, delta: '-10.00', reason, at: new Date().toISOString() }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Ждёт, пока условие выполнится, но не дольше указанного времени. */
async function until(check: () => boolean, timeoutMs = 2000): Promise<boolean> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (check()) return true
    await wait(20)
  }

  return check()
}

beforeAll(async () => {
  if (!(await pingRedis())) {
    throw new Error('Тесты событий требуют Redis. Запустите: bun run infra:up')
  }
})

afterAll(async () => {
  closeEventSubscriber()
  await closeRedis()
})

describe('события баланса', () => {
  test('опубликованное событие доходит до подписчика', async () => {
    const received: BalanceEvent[] = []
    const unsubscribe = subscribeBalance('spec-user-1', (value) => received.push(value))

    // Даём подписке осесть на сервере, прежде чем публиковать.
    await wait(200)
    await publishBalance('spec-user-1', event('240.00'))

    expect(await until(() => received.length > 0)).toBe(true)
    expect(received[0]?.balance).toBe('240.00')

    unsubscribe()
  })

  test('событие чужого игрока не приходит', async () => {
    const received: BalanceEvent[] = []
    const unsubscribe = subscribeBalance('spec-user-2', (value) => received.push(value))

    await wait(200)
    await publishBalance('spec-user-3', event('999.00'))
    await wait(300)

    expect(received).toHaveLength(0)

    unsubscribe()
  })

  test('несколько подписчиков одного игрока получают событие оба', async () => {
    const first: BalanceEvent[] = []
    const second: BalanceEvent[] = []

    const offFirst = subscribeBalance('spec-user-4', (value) => first.push(value))
    const offSecond = subscribeBalance('spec-user-4', (value) => second.push(value))

    await wait(200)
    await publishBalance('spec-user-4', event('150.00'))

    expect(await until(() => first.length > 0 && second.length > 0)).toBe(true)

    offFirst()
    offSecond()
  })

  test('отписка одного подписчика не гасит остальных', async () => {
    const keep: BalanceEvent[] = []
    const drop: BalanceEvent[] = []

    const offKeep = subscribeBalance('spec-user-5', (value) => keep.push(value))
    const offDrop = subscribeBalance('spec-user-5', (value) => drop.push(value))

    await wait(200)
    offDrop()

    await publishBalance('spec-user-5', event('120.00'))

    expect(await until(() => keep.length > 0)).toBe(true)
    expect(drop).toHaveLength(0)

    offKeep()
  })

  test('после отписки событий больше нет', async () => {
    const received: BalanceEvent[] = []
    const unsubscribe = subscribeBalance('spec-user-6', (value) => received.push(value))

    await wait(200)
    await publishBalance('spec-user-6', event('100.00'))
    await until(() => received.length > 0)

    unsubscribe()
    await wait(200)

    const countAfterUnsubscribe = received.length
    await publishBalance('spec-user-6', event('90.00'))
    await wait(300)

    expect(received).toHaveLength(countAfterUnsubscribe)
  })

  test('счётчик подписок отражает активные каналы', () => {
    const before = activeSubscriptions()
    const unsubscribe = subscribeBalance('spec-user-7', () => {})

    expect(activeSubscriptions()).toBe(before + 1)

    unsubscribe()
    expect(activeSubscriptions()).toBe(before)
  })

  test('недоступный Redis не роняет публикацию', async () => {
    // Публикация — удобство, а не источник правды: операция не должна падать.
    await expect(publishBalance('spec-user-8', event('10.00'))).resolves.toBeUndefined()
  })
})
