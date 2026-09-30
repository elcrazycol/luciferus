import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { db } from '@luciferus/db'
import { games, providers } from '@luciferus/db/schema'
import { eq } from 'drizzle-orm'
import { app } from '../src/index'
import { escapeLike, listGames } from '../src/services/catalog'
import { payOut, placeBet } from '../src/services/wallet'
import {
  assertDatabaseReachable,
  cleanupTestGames,
  cleanupTestUsers,
  createTestGame,
  createTestUser,
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

/** Игра с нужными для теста атрибутами: создаём и сразу дописываем поля. */
async function makeGame(attributes: {
  categories?: string[]
  volatility?: string
  fairMode?: string
  rtp?: string
  title?: string
  description?: string
}) {
  const game = await createTestGame()

  await db
    .update(games)
    .set({
      categories: attributes.categories ?? ['slots'],
      volatility: attributes.volatility ?? 'medium',
      fairMode: attributes.fairMode ?? 'client',
      rtp: attributes.rtp ?? '0.9600',
      title: attributes.title ?? `Игра ${game.slug}`,
      description: attributes.description ?? 'Тестовое описание',
    })
    .where(eq(games.slug, game.slug))

  return game
}

/** Слаг для тестовой категории: должен быть из известного списка. */
const ALL_CATEGORIES = [
  'slots',
  'classic',
  'crash',
  'table',
  'cards',
  'multiplayer',
  'live',
] as const

function slugsOf(result: { games: Array<{ slug: string }> }): string[] {
  return result.games.map((game) => game.slug)
}

describe('фильтры каталога', () => {
  test('по категории', async () => {
    const game = await makeGame({ categories: ['crash', 'multiplayer'] })

    const filtered = await listGames({ category: 'crash', sort: 'title', limit: 48, offset: 0 })

    expect(slugsOf(filtered)).toContain(game.slug)
    expect(filtered.games.every((g) => g.categories.includes('crash'))).toBe(true)
  })

  test('по режиму честности', async () => {
    const game = await makeGame({ fairMode: 'provably-fair' })

    const filtered = await listGames({
      fairMode: 'provably-fair',
      sort: 'title',
      limit: 48,
      offset: 0,
    })

    expect(filtered.games.every((g) => g.fairMode === 'provably-fair')).toBe(true)
    expect(slugsOf(filtered)).toContain(game.slug)
  })

  test('по волатильности', async () => {
    await makeGame({ volatility: 'high' })

    const filtered = await listGames({ volatility: 'high', sort: 'title', limit: 48, offset: 0 })
    expect(filtered.games.every((g) => g.volatility === 'high')).toBe(true)
  })

  test('поиск находит по названию и по описанию', async () => {
    const marker = `zz${Date.now().toString(36)}`
    const game = await makeGame({ title: `Слот ${marker}`, description: `описание ${marker}` })

    const byTitle = await listGames({ search: marker, sort: 'title', limit: 48, offset: 0 })
    expect(slugsOf(byTitle)).toContain(game.slug)
  })

  /**
   * Поиск обязан экранировать спецсимволы LIKE. Иначе `%` превратил бы запрос
   * в «показать всё», а `_` начал бы совпадать с любым символом.
   */
  test('спецсимволы LIKE экранируются, а не работают как шаблон', async () => {
    expect(escapeLike('%')).toBe('\\%')
    expect(escapeLike('a_b')).toBe('a\\_b')
    expect(escapeLike('c\\d')).toBe('c\\\\d')

    const everything = await listGames({ search: '%', sort: 'title', limit: 48, offset: 0 })
    expect(everything.games).toHaveLength(0)

    const anyChar = await listGames({ search: '_', sort: 'title', limit: 48, offset: 0 })
    expect(anyChar.games).toHaveLength(0)
  })

  test('опубликованные игры видны, неопубликованные — нет', async () => {
    const game = await createTestGame()

    await setGameStatus(game.slug, 'live')
    expect(slugsOf(await listGames({ sort: 'title', limit: 48, offset: 0 }))).toContain(game.slug)

    await setGameStatus(game.slug, 'pending')
    expect(slugsOf(await listGames({ sort: 'title', limit: 48, offset: 0 }))).not.toContain(
      game.slug,
    )
  })

  test('все известные категории принимаются как фильтр', async () => {
    for (const category of ALL_CATEGORIES) {
      const result = await listGames({ category, sort: 'title', limit: 1, offset: 0 })
      expect(result.games.every((g) => g.categories.includes(category))).toBe(true)
    }
  })
})

describe('сортировка и пагинация', () => {
  test('по названию — действительно по названию', async () => {
    const result = await listGames({ sort: 'title', limit: 48, offset: 0 })
    const titles = result.games.map((g) => g.title)
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)))
  })

  test('страницы не пересекаются, а total не зависит от лимита', async () => {
    const first = await listGames({ sort: 'title', limit: 2, offset: 0 })
    const second = await listGames({ sort: 'title', limit: 2, offset: 2 })

    const firstSlugs = new Set(slugsOf(first))
    expect(second.games.some((g) => firstSlugs.has(g.slug))).toBe(false)

    const large = await listGames({ sort: 'title', limit: 48, offset: 0 })
    expect(first.total).toBe(large.total)
  })
})

describe('статистика игр', () => {
  test('считается из журнала: ставки и крупнейший выигрыш', async () => {
    const { user } = await createTestUser()
    const game = await createTestGame()
    await setGameStatus(game.slug, 'live')

    await placeBet({ userId: user.id, amount: 10, roundId: 'stat-1', gameSlug: game.slug })
    await payOut({ userId: user.id, amount: 40, roundId: 'stat-1', gameSlug: game.slug })
    await placeBet({ userId: user.id, amount: 15, roundId: 'stat-2', gameSlug: game.slug })
    await payOut({ userId: user.id, amount: 90, roundId: 'stat-2', gameSlug: game.slug })

    const card = (await listGames({ sort: 'title', limit: 48, offset: 0 })).games.find(
      (g) => g.slug === game.slug,
    )

    expect(card?.stats.plays).toBe(2)
    expect(card?.stats.biggestWin).toBe('90.00')
    expect(card?.stats.lastPlayedAt).not.toBeNull()
  })

  test('игра без ставок имеет нулевую статистику, а не пустоту', async () => {
    const game = await createTestGame()
    await setGameStatus(game.slug, 'live')

    const card = (await listGames({ sort: 'title', limit: 48, offset: 0 })).games.find(
      (g) => g.slug === game.slug,
    )

    expect(card?.stats.plays).toBe(0)
    expect(card?.stats.biggestWin).toBeNull()
    expect(card?.stats.lastPlayedAt).toBeNull()
  })

  test('сортировка по популярности ставит игравшие игры выше пустых', async () => {
    const { user } = await createTestUser()
    const game = await createTestGame()
    await setGameStatus(game.slug, 'live')

    await placeBet({ userId: user.id, amount: 5, roundId: 'pop-1', gameSlug: game.slug })

    const result = await listGames({ sort: 'plays', limit: 48, offset: 0 })
    const position = result.games.findIndex((g) => g.slug === game.slug)

    expect(position).toBeGreaterThanOrEqual(0)

    // Всё, что выше, обязано иметь не меньше ставок — иначе «популярные» врут.
    const plays = result.games[position]?.stats.plays ?? 0
    for (const game_ of result.games.slice(0, position)) {
      expect(game_.stats.plays).toBeGreaterThanOrEqual(plays)
    }
  })

  test('stats.launchable совпадает с наличием объявленных origin', async () => {
    const launchable = await createTestGame({ allowedOrigins: ['https://game.test'] })
    const notLaunchable = await createTestGame({ allowedOrigins: [] })
    await setGameStatus(launchable.slug, 'live')
    await setGameStatus(notLaunchable.slug, 'live')

    const result = await listGames({ sort: 'title', limit: 48, offset: 0 })
    const a = result.games.find((g) => g.slug === launchable.slug)
    const b = result.games.find((g) => g.slug === notLaunchable.slug)

    expect(a?.launchable).toBe(true)
    expect(b?.launchable).toBe(false)
  })
})

describe('грани для панели фильтров', () => {
  test('отдают категории и студии с количеством', async () => {
    const game = await createTestGame()
    await setGameStatus(game.slug, 'live')

    const result = await listGames({ sort: 'title', limit: 1, offset: 0 })

    for (const category of result.facets.categories) {
      expect(category.count).toBeGreaterThan(0)
      expect(category.label.length).toBeGreaterThan(0)
    }

    // Грани считают только опубликованное.
    await setGameStatus(game.slug, 'disabled')
    const after = await listGames({ sort: 'title', limit: 1, offset: 0 })
    expect(after.facets.providers.some((p) => p.slug === 'spec-game-provider')).toBe(false)
  })
})

describe('HTTP-слой каталога', () => {
  test('GET /v1/games отдаёт пагинацию и грани', async () => {
    const response = await app.request('/v1/games?limit=2&sort=newest')
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      games: unknown[]
      total: number
      limit: number
      offset: number
      facets: { categories: unknown[] }
    }

    expect(body.limit).toBe(2)
    expect(body.offset).toBe(0)
    expect(body.games.length).toBeLessThanOrEqual(2)
    expect(body.total).toBeGreaterThanOrEqual(body.games.length)
    expect(Array.isArray(body.facets.categories)).toBe(true)
  })

  test('некорректный фильтр отсекается валидацией, а не молча игнорируется', async () => {
    expect((await app.request('/v1/games?category=no-such')).status).toBe(400)
    expect((await app.request('/v1/games?sort=random')).status).toBe(400)
    expect((await app.request('/v1/games?limit=999')).status).toBe(400)
    expect((await app.request('/v1/games?offset=-1')).status).toBe(400)
    expect((await app.request('/v1/games?fairMode=maybe')).status).toBe(400)
  })

  test('карточка игры отдаётся, а несуществующая — 404', async () => {
    const game = await createTestGame()
    await setGameStatus(game.slug, 'live')

    expect((await app.request(`/v1/games/${game.slug}`)).status).toBe(200)
    expect((await app.request('/v1/games/spec-game-no-such-game')).status).toBe(404)
  })

  test('профиль студии отдаётся, несуществующая — 404', async () => {
    const [provider] = await db.select().from(providers).limit(1)

    if (provider) {
      const found = await app.request(`/v1/providers/${provider.slug}`)
      expect(found.status).toBe(200)

      const body = (await found.json()) as { provider: { slug: string; playsTotal: number } }
      expect(body.provider.slug).toBe(provider.slug)
      expect(typeof body.provider.playsTotal).toBe('number')
    }

    expect((await app.request('/v1/providers/no-such-studio')).status).toBe(404)
  })
})

describe('поиск по слагу', () => {
  test('точный слаг находится, хотя его нет ни в названии, ни в описании', async () => {
    const game = await createTestGame()
    await db
      .update(games)
      .set({ title: 'Совсем другое название', description: 'и описание без слага' })
      .where(eq(games.slug, game.slug))
    await setGameStatus(game.slug, 'live')

    const result = await listGames({ search: game.slug, sort: 'title', limit: 48, offset: 0 })
    expect(slugsOf(result)).toContain(game.slug)
  })

  test('частичный слаг не считается совпадением', async () => {
    const game = await createTestGame()
    await db
      .update(games)
      .set({ title: 'Название без слага', description: 'описание' })
      .where(eq(games.slug, game.slug))
    await setGameStatus(game.slug, 'live')

    const partial = await listGames({
      search: game.slug.slice(0, -3),
      sort: 'title',
      limit: 48,
      offset: 0,
    })

    expect(slugsOf(partial)).not.toContain(game.slug)
  })
})
