import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { consumeRateLimit } from '../src/lib/rate-limit'
import { closeRedis, pingRedis } from '../src/lib/redis'

/**
 * Тесты примитива лимитирования против настоящего Redis.
 *
 * Middleware отключает лимиты при NODE_ENV=test, поэтому проверяем именно
 * `consumeRateLimit` — единственное место, где логика вообще есть.
 */

const runId = Date.now().toString(36)

beforeAll(async () => {
  if (!(await pingRedis())) {
    throw new Error('Тесты лимитов требуют Redis. Запустите: bun run infra:up')
  }
})

afterAll(async () => {
  await closeRedis()
})

describe('consumeRateLimit', () => {
  test('пропускает в пределах лимита и блокирует сверх него', async () => {
    const key = `spec-basic-${runId}`

    const first = await consumeRateLimit(key, 2, 60)
    const second = await consumeRateLimit(key, 2, 60)
    const third = await consumeRateLimit(key, 2, 60)

    expect(first.allowed).toBe(true)
    expect(first.remaining).toBe(1)

    expect(second.allowed).toBe(true)
    expect(second.remaining).toBe(0)

    expect(third.allowed).toBe(false)
    expect(third.remaining).toBe(0)
    expect(third.retryAfterSeconds).toBeGreaterThan(0)
    expect(third.retryAfterSeconds).toBeLessThanOrEqual(60)
  })

  test('разные ключи не влияют друг на друга', async () => {
    const a = await consumeRateLimit(`spec-a-${runId}`, 1, 60)
    const b = await consumeRateLimit(`spec-b-${runId}`, 1, 60)

    expect(a.allowed).toBe(true)
    expect(b.allowed).toBe(true)
  })

  test('счётчик действительно живёт в Redis, а не в памяти процесса', async () => {
    const key = `spec-persist-${runId}`

    await consumeRateLimit(key, 1, 60)
    const blocked = await consumeRateLimit(key, 1, 60)

    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(50)
  })
})
