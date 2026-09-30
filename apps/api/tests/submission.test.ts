import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { serverConfig } from '@luciferus/config'
import { db } from '@luciferus/db'
import { gameVersions, users } from '@luciferus/db/schema'
import { desc, eq } from 'drizzle-orm'
import { app } from '../src/index'
import { bumpVersion } from '../src/services/submission'
import {
  assertDatabaseReachable,
  balanceOf,
  cleanupTestGames,
  cleanupTestUsers,
  createTestUser,
  ledgerOf,
  setGameStatus,
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

function submission(overrides: Record<string, unknown> = {}) {
  const slug = `spec-game-${Math.random().toString(36).slice(2, 10)}`

  return {
    slug,
    title: `Тестовая игра ${slug}`,
    description: 'Описание игры для теста',
    embedUrl: 'https://game.test/play',
    origins: ['https://game.test'],
    categories: ['slots'],
    tags: ['тест'],
    fairMode: 'client',
    volatility: 'medium',
    limits: { minBet: 1, maxBet: 50, maxWin: 2000 },
    ...overrides,
  }
}

function post(path: string, body: unknown, token: string) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

function patch(path: string, body: unknown, token: string) {
  return app.request(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

function get(path: string, token?: string) {
  return app.request(path, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

/** Админ для тестов модерации: правим роль прямо в базе. */
async function createAdmin() {
  const admin = await createTestUser()
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin.user.id))
  return admin
}

describe('заявка на публикацию', () => {
  test('создаётся, статус зависит от флага авто-одобрения', async () => {
    const { session } = await createTestUser()
    const payload = submission()

    const response = await post('/v1/games', payload, session.token)
    expect(response.status).toBe(201)

    const body = (await response.json()) as {
      game: { slug: string; status: string; allowedOrigins: string[]; launchable: boolean }
    }

    expect(body.game.slug).toBe(payload.slug)
    // Флаг честно проверяем, а не подгоняем тест под окружение.
    expect(body.game.status).toBe(serverConfig.autoApproveGames ? 'live' : 'pending')
    expect(body.game.allowedOrigins).toEqual(['https://game.test'])
    expect(body.game.launchable).toBe(true)
  })

  test('создаёт студию автору автоматически', async () => {
    const { session, user } = await createTestUser()

    await post('/v1/games', submission(), session.token)

    const mine = await get('/v1/games/mine', session.token)
    expect(mine.status).toBe(200)

    const body = (await mine.json()) as { games: Array<{ providerSlug: string | null }> }
    expect(body.games[0]?.providerSlug).toBe(`u-${user.username}`)
  })

  test('занятый слаг — 409', async () => {
    const { session } = await createTestUser()
    const payload = submission()

    expect((await post('/v1/games', payload, session.token)).status).toBe(201)

    const second = await post('/v1/games', payload, session.token)
    expect(second.status).toBe(409)

    const body = (await second.json()) as { message: string }
    expect(body.message).toContain(payload.slug)
  })

  test('origin`ы нормализуются и не дублируются', async () => {
    const { session } = await createTestUser()

    const response = await post(
      '/v1/games',
      submission({
        origins: ['https://game.test/', 'https://game.test', 'https://cdn.game.test/'],
      }),
      session.token,
    )

    expect(response.status).toBe(201)

    const body = (await response.json()) as { game: { allowedOrigins: string[] } }
    expect(body.game.allowedOrigins.sort()).toEqual(['https://cdn.game.test', 'https://game.test'])
  })

  test('без сессии — 401', async () => {
    const response = await app.request('/v1/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(submission()),
    })

    expect(response.status).toBe(401)
  })
})

describe('валидация заявки', () => {
  test('origin страницы игры обязан быть среди объявленных', async () => {
    const { session } = await createTestUser()

    const response = await post(
      '/v1/games',
      submission({ embedUrl: 'https://other.test/play', origins: ['https://game.test'] }),
      session.token,
    )

    expect(response.status).toBe(400)

    const body = (await response.json()) as { details: { fields: Record<string, string[]> } }
    expect(body.details.fields.origins?.[0]).toContain('среди объявленных')
  })

  test('origin с путём отклоняется: это адрес страницы, а не origin', async () => {
    const { session } = await createTestUser()

    const response = await post(
      '/v1/games',
      submission({ origins: ['https://game.test/play'] }),
      session.token,
    )

    expect(response.status).toBe(400)
  })

  test('пустой список origin`ов отклоняется', async () => {
    const { session } = await createTestUser()
    expect((await post('/v1/games', submission({ origins: [] }), session.token)).status).toBe(400)
  })

  test('слаг проверяется по формату', async () => {
    const { session } = await createTestUser()

    for (const slug of ['ab', 'С-Заглавными', 'с_подчёркиванием', 'двойной--дефис', '']) {
      const response = await post('/v1/games', submission({ slug }), session.token)
      expect(response.status).toBe(400)
    }
  })

  test('лимиты проверяются на согласованность', async () => {
    const { session } = await createTestUser()

    const badMaxBet = await post(
      '/v1/games',
      submission({ limits: { minBet: 100, maxBet: 10, maxWin: 1000 } }),
      session.token,
    )
    expect(badMaxBet.status).toBe(400)

    const badMaxWin = await post(
      '/v1/games',
      submission({ limits: { minBet: 1, maxBet: 100, maxWin: 50 } }),
      session.token,
    )
    expect(badMaxWin.status).toBe(400)

    const negative = await post(
      '/v1/games',
      submission({ limits: { minBet: -5, maxBet: 100, maxWin: 1000 } }),
      session.token,
    )
    expect(negative.status).toBe(400)
  })

  test('неизвестная категория отклоняется', async () => {
    const { session } = await createTestUser()

    const response = await post(
      '/v1/games',
      submission({ categories: ['не-существует'] }),
      session.token,
    )

    expect(response.status).toBe(400)
  })
})

describe('обновление игры', () => {
  test('чужая игра не обновляется', async () => {
    const owner = await createTestUser()
    const stranger = await createTestUser()
    const payload = submission()

    await post('/v1/games', payload, owner.session.token)

    const response = await patch(
      `/v1/games/${payload.slug}`,
      { description: 'подменил' },
      stranger.session.token,
    )

    expect(response.status).toBe(403)
  })

  test('смена адреса возвращает игру на модерацию', async () => {
    const { session } = await createTestUser()
    const payload = submission()

    await post('/v1/games', payload, session.token)

    const response = await patch(
      `/v1/games/${payload.slug}`,
      { embedUrl: 'https://game.test/v2' },
      session.token,
    )

    expect(response.status).toBe(200)

    const body = (await response.json()) as { game: { status: string } }
    expect(body.game.status).toBe('pending')
  })

  test('правка описания статус не трогает', async () => {
    const { session } = await createTestUser()
    const payload = submission()

    const created = (await (await post('/v1/games', payload, session.token)).json()) as {
      game: { status: string }
    }

    const response = await patch(
      `/v1/games/${payload.slug}`,
      { description: 'Новое описание' },
      session.token,
    )

    const body = (await response.json()) as { game: { status: string; description: string } }
    expect(body.game.status).toBe(created.game.status)
    expect(body.game.description).toBe('Новое описание')
  })

  test('версия фиксируется только при смене содержимого', async () => {
    const { session } = await createTestUser()
    const payload = submission()

    await post('/v1/games', payload, session.token)

    const gameId = async () => {
      const [game] = await db
        .select({ id: gameVersions.gameId })
        .from(gameVersions)
        .orderBy(desc(gameVersions.publishedAt))
        .limit(1)
      return game?.id
    }

    const id = await gameId()

    await patch(`/v1/games/${payload.slug}`, { description: 'только текст' }, session.token)
    const afterCosmetic = await db
      .select()
      .from(gameVersions)
      .where(eq(gameVersions.gameId, id ?? ''))

    expect(afterCosmetic).toHaveLength(1)

    await patch(`/v1/games/${payload.slug}`, { embedUrl: 'https://game.test/v2' }, session.token)
    const afterContent = await db
      .select()
      .from(gameVersions)
      .where(eq(gameVersions.gameId, id ?? ''))

    expect(afterContent).toHaveLength(2)
    expect(afterContent.map((v) => v.version)).toContain('1.1.0')
  })

  test('bumpVersion растёт по минорной части', () => {
    expect(bumpVersion('1.0.0')).toBe('1.1.0')
    expect(bumpVersion('1.7.3')).toBe('1.8.0')
    expect(bumpVersion('мусор')).toBe('мусор.1.0')
  })
})

describe('модерация', () => {
  test('не-админ в админку не проходит', async () => {
    const { session } = await createTestUser()

    expect((await get('/v1/admin/overview', session.token)).status).toBe(403)
    expect((await get('/v1/admin/games', session.token)).status).toBe(403)

    const moderate = await post(
      '/v1/admin/games/lucky-7s/moderate',
      { decision: 'disable' },
      session.token,
    )
    expect(moderate.status).toBe(403)
  })

  test('без сессии — 401', async () => {
    expect((await get('/v1/admin/overview')).status).toBe(401)
  })

  test('очередь отдаёт заявки с автором', async () => {
    const admin = await createAdmin()
    const author = await createTestUser()
    const payload = submission()

    await post('/v1/games', payload, author.session.token)
    // В локальной разработке авто-одобрение включено, поэтому статус задаём явно:
    // тест обязан вести себя одинаково и в CI, и на машине разработчика.
    await setGameStatus(payload.slug, 'pending')

    const response = await get('/v1/admin/games?status=pending', admin.session.token)
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      games: Array<{ slug: string; authorUsername: string | null }>
      status: string
    }

    expect(body.status).toBe('pending')
    const entry = body.games.find((game) => game.slug === payload.slug)
    expect(entry?.authorUsername).toBe(author.user.username)
  })

  test('одобрение публикует игру в каталоге', async () => {
    const admin = await createAdmin()
    const author = await createTestUser()
    const payload = submission()

    await post('/v1/games', payload, author.session.token)
    await setGameStatus(payload.slug, 'pending')

    const response = await post(
      `/v1/admin/games/${payload.slug}/moderate`,
      { decision: 'approve' },
      admin.session.token,
    )

    expect(response.status).toBe(200)

    const catalogue = await get(`/v1/games?search=${payload.slug}`)
    const body = (await catalogue.json()) as { games: Array<{ slug: string }> }
    expect(body.games.map((game) => game.slug)).toContain(payload.slug)
  })

  test('отклонение с причиной видно автору', async () => {
    const admin = await createAdmin()
    const author = await createTestUser()
    const payload = submission()

    await post('/v1/games', payload, author.session.token)
    await setGameStatus(payload.slug, 'pending')

    await post(
      `/v1/admin/games/${payload.slug}/moderate`,
      { decision: 'reject', note: 'Слот без RTP-таблицы' },
      admin.session.token,
    )

    const mine = await get('/v1/games/mine', author.session.token)
    const body = (await mine.json()) as {
      games: Array<{ slug: string; status: string; moderationNote: string | null }>
    }

    const entry = body.games.find((game) => game.slug === payload.slug)
    expect(entry?.status).toBe('draft')
    expect(entry?.moderationNote).toBe('Слот без RTP-таблицы')
  })

  test('отключение убирает игру из каталога', async () => {
    const admin = await createAdmin()
    const author = await createTestUser()
    const payload = submission()

    await post('/v1/games', payload, author.session.token)
    await setGameStatus(payload.slug, 'pending')
    await post(
      `/v1/admin/games/${payload.slug}/moderate`,
      { decision: 'approve' },
      admin.session.token,
    )

    const before = await get(`/v1/games?search=${payload.slug}`)
    expect(((await before.json()) as { games: unknown[] }).games).toHaveLength(1)

    await post(
      `/v1/admin/games/${payload.slug}/moderate`,
      { decision: 'disable', note: 'Сломанный хендшейк' },
      admin.session.token,
    )

    const after = await get(`/v1/games?search=${payload.slug}`)
    expect(((await after.json()) as { games: unknown[] }).games).toHaveLength(0)
  })

  test('сводка считает игры по статусам', async () => {
    const admin = await createAdmin()

    const response = await get('/v1/admin/overview', admin.session.token)
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      games: { pending: number; live: number; disabled: number; drafts: number }
    }

    for (const value of Object.values(body.games)) {
      expect(typeof value).toBe('number')
      expect(value).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('правка баланса администратором', () => {
  test('начисление попадает в журнал с причиной и автором', async () => {
    const admin = await createAdmin()
    const player = await createTestUser()

    const response = await post(
      `/v1/admin/users/${player.user.id}/balance`,
      { amount: 500, note: 'Компенсация за сломанный раунд' },
      admin.session.token,
    )

    expect(response.status).toBe(200)
    expect(await balanceOf(player.user.id)).toBe('750.00')

    const entries = await ledgerOf(player.user.id)
    const adjustment = entries.find((entry) => entry.type === 'admin_adjust')

    expect(adjustment?.amount).toBe('500.00')
    expect(adjustment?.meta).toMatchObject({
      note: 'Компенсация за сломанный раунд',
      adminId: admin.user.id,
    })

    // Игрок видит корректировку в своей истории.
    const history = await get('/v1/wallet/ledger', player.session.token)
    const body = (await history.json()) as { entries: Array<{ type: string }> }
    expect(body.entries.some((entry) => entry.type === 'admin_adjust')).toBe(true)
  })

  test('списание больше баланса отклоняется', async () => {
    const admin = await createAdmin()
    const player = await createTestUser()

    const response = await post(
      `/v1/admin/users/${player.user.id}/balance`,
      { amount: -1000, code: 'x', note: 'Забрать всё' },
      admin.session.token,
    )

    expect(response.status).toBe(402)
    expect(await balanceOf(player.user.id)).toBe('250.00')
  })

  test('без причины не принимается', async () => {
    const admin = await createAdmin()
    const player = await createTestUser()

    const response = await post(
      `/v1/admin/users/${player.user.id}/balance`,
      { amount: 10, note: 'ок' },
      admin.session.token,
    )

    // Слишком короткая причина не проходит: её потом читает игрок.
    expect(response.status).toBe(400)
  })

  test('нулевая сумма отклоняется', async () => {
    const admin = await createAdmin()
    const player = await createTestUser()

    const response = await post(
      `/v1/admin/users/${player.user.id}/balance`,
      { amount: 0, note: 'ничего не делаем' },
      admin.session.token,
    )

    expect(response.status).toBe(400)
  })

  test('каждая корректировка — отдельная запись, без схлопывания', async () => {
    const admin = await createAdmin()
    const player = await createTestUser()

    for (const amount of [10, 10, 10]) {
      await post(
        `/v1/admin/users/${player.user.id}/balance`,
        { amount, note: 'Начисление за тест' },
        admin.session.token,
      )
    }

    const entries = await ledgerOf(player.user.id)
    expect(entries.filter((entry) => entry.type === 'admin_adjust')).toHaveLength(3)
    expect(await balanceOf(player.user.id)).toBe('280.00')
  })

  test('несуществующий игрок — 404, а не тихое создание кошелька', async () => {
    const admin = await createAdmin()

    const response = await post(
      '/v1/admin/users/00000000-0000-0000-0000-000000000000/balance',
      { amount: 10, note: 'Проверка' },
      admin.session.token,
    )

    expect(response.status).toBe(404)
  })
})

describe('список своих игр', () => {
  test('возвращает только свои', async () => {
    const first = await createTestUser()
    const second = await createTestUser()

    await post('/v1/games', submission(), first.session.token)
    await post('/v1/games', submission(), second.session.token)

    const mine = await get('/v1/games/mine', first.session.token)
    const body = (await mine.json()) as { games: Array<{ slug: string }> }

    expect(body.games).toHaveLength(1)
  })

  test('чужой слаг через /mine не отдаётся', async () => {
    const owner = await createTestUser()
    const stranger = await createTestUser()
    const payload = submission()

    await post('/v1/games', payload, owner.session.token)

    expect((await get(`/v1/games/${payload.slug}/mine`, stranger.session.token)).status).toBe(403)
    expect((await get(`/v1/games/${payload.slug}/mine`, owner.session.token)).status).toBe(200)
  })

  test('slug из будущего не путается с /mine', async () => {
    const { session } = await createTestUser()
    const response = await get('/v1/games/mine', session.token)

    // Если бы «mine» перехватывался маршрутом /:slug, вернулась бы 404 игры «mine».
    expect(response.status).toBe(200)
    expect((await response.json()) as { games: unknown[] }).toMatchObject({ games: [] })
  })
})
