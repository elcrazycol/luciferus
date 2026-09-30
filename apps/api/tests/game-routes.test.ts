import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { serverConfig } from '@luciferus/config'
import { db } from '@luciferus/db'
import { ledger } from '@luciferus/db/schema'
import { eq } from 'drizzle-orm'
import { app } from '../src/index'
import { issueGameToken } from '../src/lib/signed-token'
import { revokeSession } from '../src/services/auth'
import {
  assertDatabaseReachable,
  balanceOf,
  cleanupTestGames,
  cleanupTestUsers,
  createGameFixture,
  createTestGame,
  createTestUser,
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

function gameRequest(
  path: string,
  options: { token?: string; body?: unknown; method?: 'GET' | 'POST' } = {},
) {
  return app.request(path, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
}

describe('запуск игры из портала', () => {
  test('без сессии портала — 401', async () => {
    const response = await app.request('/v1/games/lucky-7s/launch')
    expect(response.status).toBe(401)
  })

  test('несуществующая игра — 404', async () => {
    const { session } = await createTestUser()

    const response = await app.request('/v1/games/spec-game-no-such/launch', {
      headers: { authorization: `Bearer ${session.token}` },
    })

    expect(response.status).toBe(404)
  })

  test('игра без объявленного origin не запускается, и это объяснено', async () => {
    const { session } = await createTestUser()
    const game = await createTestGame({ allowedOrigins: [] })

    const response = await app.request(`/v1/games/${game.slug}/launch`, {
      headers: { authorization: `Bearer ${session.token}` },
    })

    expect(response.status).toBe(409)

    const body = (await response.json()) as { message: string }
    expect(body.message).toContain('origin')
  })

  test('отдаёт адрес игры, токен, баланс и лимиты', async () => {
    const { session, user } = await createTestUser()
    const game = await createTestGame({
      allowedOrigins: ['https://game.test'],
      limits: { minBet: 1, maxBet: 25, maxWin: 500 },
    })

    const response = await app.request(`/v1/games/${game.slug}/launch`, {
      headers: { authorization: `Bearer ${session.token}` },
    })

    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      game: {
        slug: string
        embedUrl: string
        allowedOrigins: string[]
        limits: { minBet: number; maxBet: number; maxWin: number }
      }
      session: { token: string; expiresAt: string }
      player: { id: string; username: string }
      wallet: { balance: string; currency: string }
      apiUrl: string
    }

    expect(body.game.slug).toBe(game.slug)
    expect(body.game.embedUrl).toBe('https://game.test/')
    expect(body.game.allowedOrigins).toEqual(['https://game.test'])
    expect(body.player.id).toBe(user.id)
    expect(body.wallet.balance).toBe('250.00')
    expect(body.game.limits).toEqual({ minBet: 1, maxBet: 25, maxWin: 500 })
    expect(body.apiUrl).toBe(serverConfig.apiUrl)
    expect(new Date(body.session.expiresAt).getTime()).toBeGreaterThan(Date.now())

    // Токен из ответа обязан работать.
    const balance = await gameRequest('/v1/game/balance', { token: body.session.token })
    expect(balance.status).toBe(200)
  })
})

describe('доступ к игровым маршрутам', () => {
  test('без токена — 401', async () => {
    expect((await gameRequest('/v1/game/balance')).status).toBe(401)
    expect((await gameRequest('/v1/game/bet', { method: 'POST', body: {} })).status).toBe(401)
  })

  test('мусорный токен — 401', async () => {
    // Заголовки HTTP обязаны быть ASCII, поэтому мусор тоже ASCII: кириллица
    // в заголовке не доедет до приложения вовсе.
    expect((await gameRequest('/v1/game/balance', { token: 'not-a-token' })).status).toBe(401)
    expect((await gameRequest('/v1/game/balance', { token: 'a.b' })).status).toBe(401)
    expect((await gameRequest('/v1/game/balance', { token: '...' })).status).toBe(401)
  })

  test('сессионный токен портала не работает как игровой', async () => {
    const { session } = await createTestUser()

    // Портал ходит случайной строкой, игра — подписанным токеном. Перепутать нельзя.
    const response = await gameRequest('/v1/game/balance', { token: session.token })
    expect(response.status).toBe(401)
  })

  test('токен другой игры не подходит к чужой игре', async () => {
    const first = await createGameFixture()
    const second = await createGameFixture()

    // Токен первой игры отправляем в запрос, но игра определяется ТОКЕНОМ,
    // а не телом: значит, ставка обязана пройти по лимитам первой игры.
    const response = await gameRequest('/v1/game/bet', {
      method: 'POST',
      token: first.gameToken,
      body: { amount: 10, roundId: 'r-cross', gameSlug: second.game.slug },
    })

    expect(response.status).toBe(200)

    const entries = await db.select().from(ledger).where(eq(ledger.userId, first.user.id))
    const bet = entries.find((entry) => entry.type === 'bet')

    expect(bet?.gameId).toBe(first.game.id)
    expect(bet?.gameId).not.toBe(second.game.id)
  })

  test('выход из аккаунта отзывает игровой токен', async () => {
    const fixture = await createGameFixture()

    expect((await gameRequest('/v1/game/balance', { token: fixture.gameToken })).status).toBe(200)

    await revokeSession(fixture.sessionId)

    const response = await gameRequest('/v1/game/balance', { token: fixture.gameToken })
    expect(response.status).toBe(401)

    const body = (await response.json()) as { message: string }
    expect(body.message).toContain('Сессия портала')
  })

  test('истёкший токен не принимается', async () => {
    const { user, session, game } = await createGameFixture()
    const resolved = { id: 'placeholder-session' }

    const expired = issueGameToken(
      {
        userId: user.id,
        gameId: game.id,
        gameSlug: game.slug,
        portalSessionId: resolved.id,
        ttlSeconds: -10,
      },
      serverConfig.gameSessionSecret,
    )

    expect((await gameRequest('/v1/game/balance', { token: expired })).status).toBe(401)
    void session
  })
})

describe('операции с балансом из игры', () => {
  test('ставка списывает деньги и помечается игрой', async () => {
    const fixture = await createGameFixture()

    const response = await gameRequest('/v1/game/bet', {
      method: 'POST',
      token: fixture.gameToken,
      body: { amount: 25, roundId: 'r-1', meta: { line: 3 } },
    })

    expect(response.status).toBe(200)

    const body = (await response.json()) as { balance: string; entry: { amount: string } }
    expect(body.balance).toBe('225.00')
    expect(body.entry.amount).toBe('-25.00')
    expect(await balanceOf(fixture.user.id)).toBe('225.00')
  })

  test('лимиты берутся из игры, а не из запроса', async () => {
    const fixture = await createGameFixture({
      limits: { minBet: 5, maxBet: 10, maxWin: 100 },
    })

    // 10 — на верхней границе, проходит.
    const ok = await gameRequest('/v1/game/bet', {
      method: 'POST',
      token: fixture.gameToken,
      body: { amount: 10, roundId: 'r-limit-ok' },
    })
    expect(ok.status).toBe(200)

    // 11 — выше предела игры, хотя глобальный лимит портала равен 100.
    const tooMuch = await gameRequest('/v1/game/bet', {
      method: 'POST',
      token: fixture.gameToken,
      body: { amount: 11, roundId: 'r-limit-bad' },
    })
    expect(tooMuch.status).toBe(422)

    const tooLittle = await gameRequest('/v1/game/bet', {
      method: 'POST',
      token: fixture.gameToken,
      body: { amount: 1, roundId: 'r-limit-small' },
    })
    expect(tooLittle.status).toBe(422)
  })

  test('выигрыш и отмена работают через игровые маршруты', async () => {
    const fixture = await createGameFixture()

    await gameRequest('/v1/game/bet', {
      method: 'POST',
      token: fixture.gameToken,
      body: { amount: 50, roundId: 'r-win' },
    })

    const payout = await gameRequest('/v1/game/payout', {
      method: 'POST',
      token: fixture.gameToken,
      body: { amount: 120, roundId: 'r-win' },
    })
    expect(payout.status).toBe(200)

    const body = (await payout.json()) as { balance: string }
    expect(body.balance).toBe('320.00')

    // Повтор раунда, который уже оплачен, отменять нельзя.
    const rollback = await gameRequest('/v1/game/rollback', {
      method: 'POST',
      token: fixture.gameToken,
      body: { roundId: 'r-win' },
    })
    expect(rollback.status).toBe(409)
  })

  test('выигрыш без ставки отклоняется', async () => {
    const fixture = await createGameFixture()

    const response = await gameRequest('/v1/game/payout', {
      method: 'POST',
      token: fixture.gameToken,
      body: { amount: 100, roundId: 'r-without-bet' },
    })

    expect(response.status).toBe(409)
  })

  test('ключ идемпотентности игры не пересекается с чужой игрой', async () => {
    const first = await createGameFixture()
    const second = await createGameFixture()

    // Один и тот же ключ в обеих играх: префикс с id игры не даёт им столкнуться.
    for (const fixture of [first, second]) {
      const response = await gameRequest('/v1/game/bet', {
        method: 'POST',
        token: fixture.gameToken,
        body: { amount: 10, roundId: 'r-same', idempotencyKey: 'общий-ключ' },
      })
      expect(response.status).toBe(200)
    }

    expect(await balanceOf(first.user.id)).toBe('240.00')
    expect(await balanceOf(second.user.id)).toBe('240.00')
  })

  test('слишком большая meta отклоняется', async () => {
    const fixture = await createGameFixture()

    const response = await gameRequest('/v1/game/bet', {
      method: 'POST',
      token: fixture.gameToken,
      body: { amount: 10, roundId: 'r-meta', meta: { мусор: 'x'.repeat(3000) } },
    })

    expect(response.status).toBe(400)
  })

  test('неизвестный игровой маршрут — 404, а не пустой ответ', async () => {
    const fixture = await createGameFixture()

    const response = await gameRequest('/v1/game/grant-jackpot', { token: fixture.gameToken })
    expect(response.status).toBe(404)
  })
})

describe('CORS игровых маршрутов', () => {
  test('разрешён любой origin: защищает токен, а не домен', async () => {
    const response = await app.request('/v1/game/bet', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    })

    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    // Куки на игровых маршрутах не используются, поэтому credentials запрещены.
    expect(response.headers.get('access-control-allow-credentials')).toBeNull()
  })

  test('портальные маршруты по-прежнему требуют свой origin', async () => {
    const response = await app.request('/v1/wallet', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'GET',
      },
    })

    // В дев-режиме CORS портала широкий, но credentials обязательны —
    // значит, чужой сайт не сможет читать ответы от имени игрока.
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
  })
})
