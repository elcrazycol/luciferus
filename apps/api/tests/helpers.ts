import { expect } from 'bun:test'
import { db } from '@luciferus/db'
import { ledger, users, wallets } from '@luciferus/db/schema'
import type { AuthResponse } from '@luciferus/protocol/auth'
import type { ApiErrorCode } from '@luciferus/protocol/errors'
import { eq, like, sql } from 'drizzle-orm'
import { AppError } from '../src/lib/errors'
import { register } from '../src/services/auth'

/**
 * Префикс тестовых аккаунтов. Без подчёркивания — в SQL `LIKE` символ `_`
 * означает «любой один символ», и `test_%` неожиданно совпал бы с `testX...`.
 */
const TEST_PREFIX = 'spec'

const TEST_PASSWORD = 'spec-password-123'

let counter = 0

export function uniqueUsername(): string {
  counter += 1
  return `${TEST_PREFIX}${Date.now().toString(36)}${counter}`
}

/** Падает с понятной подсказкой, если Postgres не поднят, вместо загадочных таймаутов. */
export async function assertDatabaseReachable(): Promise<void> {
  try {
    await db.execute(sql`select 1`)
  } catch (error) {
    throw new Error('Тесты требуют Postgres. Запустите: bun run infra:up && bun run db:migrate', {
      cause: error,
    })
  }
}

export async function cleanupTestUsers(): Promise<void> {
  // Кошельки, сессии и леджер уходят каскадом по внешним ключам.
  await db.delete(users).where(like(users.username, `${TEST_PREFIX}%`))
}

export async function createTestUser(): Promise<AuthResponse> {
  return register({
    username: uniqueUsername(),
    displayName: 'Тестовый игрок',
    password: TEST_PASSWORD,
  })
}

export { TEST_PASSWORD }

export async function balanceOf(userId: string): Promise<string> {
  const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1)
  if (!wallet) throw new Error(`Кошелёк ${userId} не найден`)
  return wallet.balance
}

export async function ledgerOf(userId: string) {
  return db.select().from(ledger).where(eq(ledger.userId, userId))
}

/**
 * Проверяет, что операция упала ожидаемым `AppError` с нужным кодом.
 * Падение по другой причине (или успех) — это провал теста, а не «ну почти».
 */
export async function expectAppError(
  promise: Promise<unknown>,
  code: ApiErrorCode,
): Promise<AppError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    const appError = error as AppError
    expect(appError.code).toBe(code)
    return appError
  }

  throw new Error(`Ожидалась ошибка «${code}», но операция прошла успешно`)
}
