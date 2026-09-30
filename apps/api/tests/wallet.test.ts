import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { economy } from '@luciferus/config/economy'
import { app } from '../src/index'
import {
  claimReloadBonus,
  getLedger,
  getWalletSummary,
  payOut,
  placeBet,
  rollbackRound,
} from '../src/services/wallet'
import {
  assertDatabaseReachable,
  balanceOf,
  cleanupTestUsers,
  createTestUser,
  expectAppError,
  ledgerOf,
} from './helpers'

beforeAll(async () => {
  await assertDatabaseReachable()
  await cleanupTestUsers()
})

afterAll(async () => {
  await cleanupTestUsers()
})

describe('стартовый бонус', () => {
  test('начисляется одним движением в леджере', async () => {
    const { user } = await createTestUser()

    expect(await balanceOf(user.id)).toBe('250.00')

    const entries = await ledgerOf(user.id)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.type).toBe('signup_bonus')
    expect(entries[0]?.amount).toBe('250.00')
    expect(entries[0]?.balanceAfter).toBe('250.00')
  })
})

describe('ставки', () => {
  test('списывают деньги и попадают в журнал', async () => {
    const { user } = await createTestUser()

    const result = await placeBet({ userId: user.id, amount: 10, roundId: 'r-1' })

    expect(result.balance).toBe('240.00')
    expect(result.entry.type).toBe('bet')
    expect(result.entry.amount).toBe('-10.00')
    expect(result.entry.balanceAfter).toBe('240.00')
    expect(result.idempotent).toBe(false)
  })

  test('повтор с тем же ключом не списывает дважды', async () => {
    const { user } = await createTestUser()

    const first = await placeBet({ userId: user.id, amount: 10, roundId: 'r-dup' })
    const second = await placeBet({ userId: user.id, amount: 10, roundId: 'r-dup' })

    expect(first.idempotent).toBe(false)
    expect(second.idempotent).toBe(true)
    expect(second.balance).toBe('240.00')
    expect(second.entry.id).toBe(first.entry.id)

    const bets = (await ledgerOf(user.id)).filter((row) => row.type === 'bet')
    expect(bets).toHaveLength(1)
  })

  test('нельзя уйти в минус', async () => {
    const { user } = await createTestUser()

    // Максимальная ставка — 100, поэтому опускаем баланс до 50 двумя ставками,
    // а затем пробуем списать больше, чем есть.
    await placeBet({ userId: user.id, amount: 100, roundId: 'r-drain-a' })
    await placeBet({ userId: user.id, amount: 100, roundId: 'r-drain-b' })
    expect(await balanceOf(user.id)).toBe('50.00')

    await expectAppError(
      placeBet({ userId: user.id, amount: 100, roundId: 'r-broke' }),
      'insufficient_funds',
    )

    expect(await balanceOf(user.id)).toBe('50.00')
  })

  test('соблюдаются минимальная и максимальная ставка', async () => {
    const { user } = await createTestUser()

    await expectAppError(
      placeBet({ userId: user.id, amount: 0.001, roundId: 'r-small' }),
      'limit_exceeded',
    )
    await expectAppError(
      placeBet({ userId: user.id, amount: economy.defaultMaxBet + 1, roundId: 'r-big' }),
      'limit_exceeded',
    )

    expect(await balanceOf(user.id)).toBe('250.00')
  })

  /**
   * Главный тест кошелька. Десять одновременных ставок по 100 при балансе 250:
   * пройти должны ровно две, третья обязана упереться в нехватку средств.
   * Без блокировки строки кошелька все десять увидели бы достаточный баланс.
   */
  test('параллельные ставки не уводят баланс в минус', async () => {
    const { user } = await createTestUser()

    const attempts = Array.from({ length: 10 }, (_, index) =>
      placeBet({ userId: user.id, amount: 100, roundId: `r-race-${index}` }),
    )
    const results = await Promise.allSettled(attempts)

    const succeeded = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')

    expect(succeeded).toHaveLength(2)
    expect(rejected).toHaveLength(8)
    expect(await balanceOf(user.id)).toBe('50.00')

    const bets = (await ledgerOf(user.id)).filter((row) => row.type === 'bet')
    expect(bets).toHaveLength(2)
  })
})

describe('выигрыши', () => {
  test('нельзя выплатить выигрыш за раунд без ставки', async () => {
    const { user } = await createTestUser()

    await expectAppError(
      payOut({ userId: user.id, amount: 100, roundId: 'r-без-ставки' }),
      'conflict',
    )
  })

  test('начисляются и не удваиваются при повторе', async () => {
    const { user } = await createTestUser()

    await placeBet({ userId: user.id, amount: 10, roundId: 'r-win' })
    const first = await payOut({ userId: user.id, amount: 50, roundId: 'r-win' })
    const second = await payOut({ userId: user.id, amount: 50, roundId: 'r-win' })

    expect(first.balance).toBe('290.00')
    expect(second.idempotent).toBe(true)
    expect(second.balance).toBe('290.00')
    expect(second.entry.id).toBe(first.entry.id)
  })

  test('повторный выигрыш по раунду с другим ключом — конфликт', async () => {
    const { user } = await createTestUser()

    await placeBet({ userId: user.id, amount: 10, roundId: 'r-double-win' })
    await payOut({ userId: user.id, amount: 50, roundId: 'r-double-win' })

    await expectAppError(
      payOut({
        userId: user.id,
        amount: 50,
        roundId: 'r-double-win',
        idempotencyKey: 'второй-ключ-на-тот-же-раунд',
      }),
      'conflict',
    )

    expect(await balanceOf(user.id)).toBe('290.00')
  })

  test('выигрыш выше предела отклоняется', async () => {
    const { user } = await createTestUser()

    await placeBet({ userId: user.id, amount: 10, roundId: 'r-jackpot' })

    await expectAppError(
      payOut({
        userId: user.id,
        amount: economy.defaultMaxWin + 1,
        roundId: 'r-jackpot',
      }),
      'limit_exceeded',
    )
  })
})

describe('отмена раунда', () => {
  test('возвращает ровно сумму ставки', async () => {
    const { user } = await createTestUser()

    await placeBet({ userId: user.id, amount: 25, roundId: 'r-cancel' })
    expect(await balanceOf(user.id)).toBe('225.00')

    const result = await rollbackRound({ userId: user.id, roundId: 'r-cancel' })

    expect(result.balance).toBe('250.00')
    expect(result.entry.type).toBe('rollback')
    expect(result.entry.amount).toBe('25.00')
  })

  test('повтор с тем же ключом идемпотентен, с другим — конфликт', async () => {
    const { user } = await createTestUser()

    await placeBet({ userId: user.id, amount: 25, roundId: 'r-cancel-2' })
    const first = await rollbackRound({ userId: user.id, roundId: 'r-cancel-2' })
    const repeat = await rollbackRound({ userId: user.id, roundId: 'r-cancel-2' })

    expect(repeat.idempotent).toBe(true)
    expect(repeat.entry.id).toBe(first.entry.id)

    await expectAppError(
      rollbackRound({ userId: user.id, roundId: 'r-cancel-2', idempotencyKey: 'другой-ключ' }),
      'conflict',
    )

    expect(await balanceOf(user.id)).toBe('250.00')
  })

  test('нельзя отменить раунд, по которому уже выплачен выигрыш', async () => {
    const { user } = await createTestUser()

    await placeBet({ userId: user.id, amount: 10, roundId: 'r-paid' })
    await payOut({ userId: user.id, amount: 100, roundId: 'r-paid' })

    await expectAppError(rollbackRound({ userId: user.id, roundId: 'r-paid' }), 'conflict')

    expect(await balanceOf(user.id)).toBe('340.00')
  })

  test('нечего отменять, если ставки не было', async () => {
    const { user } = await createTestUser()

    await expectAppError(rollbackRound({ userId: user.id, roundId: 'r-пустой' }), 'conflict')
  })
})

describe('дозаправка баланса', () => {
  test('недоступна при живом балансе', async () => {
    const { user } = await createTestUser()

    const summary = await getWalletSummary(user.id)
    expect(summary.reload.available).toBe(false)
    expect(summary.reload.blockedBy).toBe('balance_above_threshold')

    await expectAppError(claimReloadBonus(user.id), 'conflict')
  })

  test('после слива баланса начисляет бонус и включает кулдаун', async () => {
    const { user } = await createTestUser()

    // Максимальная ставка — 100, поэтому сливаем баланс тремя ставками.
    await placeBet({ userId: user.id, amount: 100, roundId: 'r-drain-1' })
    await placeBet({ userId: user.id, amount: 100, roundId: 'r-drain-2' })
    await placeBet({ userId: user.id, amount: 50, roundId: 'r-drain-3' })
    expect(await balanceOf(user.id)).toBe('0.00')

    const result = await claimReloadBonus(user.id)
    expect(result.balance).toBe(economy.reloadBonus.toFixed(2))
    expect(result.entry.type).toBe('reload_bonus')
    expect(new Date(result.nextAvailableAt).getTime()).toBeGreaterThan(Date.now())

    // Кулдаун: снова сливаем баланс, но повторно дозаправиться ещё нельзя.
    await placeBet({ userId: user.id, amount: 100, roundId: 'r-drain-4' })

    const summary = await getWalletSummary(user.id)
    expect(summary.reload.available).toBe(false)
    expect(summary.reload.blockedBy).toBe('cooldown')

    const error = await expectAppError(claimReloadBonus(user.id), 'rate_limited')
    expect((error.details as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0)
  })
})

describe('история операций', () => {
  test('отдаёт записи от новых к старым с курсором', async () => {
    const { user } = await createTestUser()

    for (let index = 0; index < 5; index += 1) {
      await placeBet({ userId: user.id, amount: 1, roundId: `r-page-${index}` })
    }

    const firstPage = await getLedger(user.id, { limit: 3 })
    expect(firstPage.entries).toHaveLength(3)
    expect(firstPage.nextCursor).not.toBeNull()

    const secondPage = await getLedger(user.id, {
      limit: 3,
      cursor: firstPage.nextCursor ?? undefined,
    })
    expect(secondPage.entries).toHaveLength(3)

    // Страницы не пересекаются: курсор реально сдвигает выборку.
    const firstIds = new Set(firstPage.entries.map((entry) => entry.id))
    const overlap = secondPage.entries.filter((entry) => firstIds.has(entry.id))
    expect(overlap).toHaveLength(0)
  })

  test('несуществующий курсор не ломает выдачу', async () => {
    const { user } = await createTestUser()

    const page = await getLedger(user.id, {
      limit: 5,
      cursor: '3f1a5b8e-2c4d-4f6a-9b0e-1d2c3b4a5f60',
    })

    expect(page.entries).toHaveLength(1)
  })

  test('история одного игрока не видна другому', async () => {
    const first = await createTestUser()
    const second = await createTestUser()

    await placeBet({ userId: first.user.id, amount: 10, roundId: 'r-private' })

    const secondPage = await getLedger(second.user.id, { limit: 20 })
    expect(secondPage.entries).toHaveLength(1)
    expect(secondPage.entries[0]?.type).toBe('signup_bonus')
  })
})

describe('HTTP-слой кошелька', () => {
  function post(path: string, body: unknown, token: string) {
    return app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  }

  test('ставка через API обновляет баланс', async () => {
    const { session } = await createTestUser()

    const response = await post('/v1/wallet/bet', { amount: 20, roundId: 'http-1' }, session.token)
    expect(response.status).toBe(200)

    const body = (await response.json()) as { balance: string; entry: { amount: string } }
    expect(body.balance).toBe('230.00')
    expect(body.entry.amount).toBe('-20.00')
  })

  test('нехватка средств отдаёт 402 с кодом insufficient_funds', async () => {
    const { session } = await createTestUser()

    // Опускаем баланс до 50, чтобы попытка списать 100 упала по нехватке средств,
    // а не по превышению максимальной ставки.
    await post('/v1/wallet/bet', { amount: 100, roundId: 'http-drain-1' }, session.token)
    await post('/v1/wallet/bet', { amount: 100, roundId: 'http-drain-2' }, session.token)

    const response = await post(
      '/v1/wallet/bet',
      { amount: 100, roundId: 'http-broke' },
      session.token,
    )

    expect(response.status).toBe(402)

    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('insufficient_funds')
  })

  test('отрицательная ставка отсекается валидацией', async () => {
    const { session } = await createTestUser()

    const response = await post(
      '/v1/wallet/bet',
      { amount: -50, roundId: 'http-negative' },
      session.token,
    )

    expect(response.status).toBe(400)
  })
})
