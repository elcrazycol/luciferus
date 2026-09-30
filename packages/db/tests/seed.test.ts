import { describe, expect, test } from 'bun:test'
import { currency } from '@luciferus/config/currency'
import { BOT_PROFILES, DEMO_USERS, SEED_GAMES, SEED_PROVIDERS } from '../src/seed'

/**
 * Тесты на сид-данные. Звучит наивно, но именно они ловят опечатки в слагах
 * провайдеров и дубли логинов до того, как `db:seed` упадёт на середине в чужом
 * окружении. Плюс фиксируют инварианты, на которые опирается остальной код.
 */

const ALL_USERS = [...DEMO_USERS, ...BOT_PROFILES]
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

describe('пользователи из сидов', () => {
  test('логины уникальны', () => {
    const usernames = ALL_USERS.map((user) => user.username)
    expect(new Set(usernames).size).toBe(usernames.length)
  })

  test('все логины годятся для входа: латиница, цифры, подчёркивание', () => {
    for (const user of ALL_USERS) {
      expect(user.username).toMatch(/^[a-z0-9_]{3,32}$/)
    }
  })

  test('есть ровно один админ и он не бот', () => {
    const admins = ALL_USERS.filter((user) => user.role === 'admin')
    expect(admins).toHaveLength(1)
    expect(admins[0]?.isBot).toBeFalsy()
  })

  test('боты помечены флагом, а демо-аккаунты — нет', () => {
    expect(DEMO_USERS.every((user) => !user.isBot)).toBe(true)
    expect(BOT_PROFILES.every((user) => user.isBot === true)).toBe(true)
    expect(BOT_PROFILES.length).toBeGreaterThanOrEqual(4)
  })

  test('балансы неотрицательны и умещаются в numeric(18,2)', () => {
    for (const user of ALL_USERS) {
      expect(user.balance).toBeGreaterThanOrEqual(0)
      expect(user.balance).toBeLessThan(1e16)

      // Больше двух знаков после запятой Postgres молча округлит — лучше упасть здесь.
      const decimals = user.balance.toString().split('.')[1]?.length ?? 0
      expect(decimals).toBeLessThanOrEqual(currency.decimals)
    }
  })
})

describe('игры и провайдеры из сидов', () => {
  test('слаги провайдеров уникальны и в kebab-case', () => {
    const slugs = SEED_PROVIDERS.map((provider) => provider.slug)
    expect(new Set(slugs).size).toBe(slugs.length)

    for (const slug of slugs) {
      expect(slug).toMatch(SLUG_PATTERN)
    }
  })

  test('слаги игр уникальны и в kebab-case', () => {
    const slugs = SEED_GAMES.map((game) => game.slug)
    expect(new Set(slugs).size).toBe(slugs.length)

    // Слаг попадает в URL портала и в манифест — формат должен быть строгим.
    for (const slug of slugs) {
      expect(slug).toMatch(SLUG_PATTERN)
    }
  })

  test('у каждой игры есть провайдер из сидов', () => {
    const known = new Set(SEED_PROVIDERS.map((provider) => provider.slug))

    for (const game of SEED_GAMES) {
      expect(known.has(game.providerSlug)).toBe(true)
    }
  })

  test('лимиты ставок согласованы', () => {
    for (const game of SEED_GAMES) {
      expect(game.limits.minBet).toBeGreaterThan(0)
      expect(game.limits.maxBet).toBeGreaterThan(game.limits.minBet)
      expect(game.limits.maxWin).toBeGreaterThan(game.limits.maxBet)
    }
  })

  test('RTP в виде доли от 0 до 1 и с 4 знаками', () => {
    for (const game of SEED_GAMES) {
      const rtp = Number.parseFloat(game.rtp)
      expect(rtp).toBeGreaterThan(0)
      expect(rtp).toBeLessThanOrEqual(1)
      expect(game.rtp).toMatch(/^\d\.\d{4}$/)
    }
  })

  test('fairMode — только client или provably-fair', () => {
    for (const game of SEED_GAMES) {
      expect(['client', 'provably-fair']).toContain(game.fairMode)
    }
  })

  test('embedUrl — абсолютный http(s) адрес', () => {
    for (const game of SEED_GAMES) {
      const url = new URL(game.embedUrl)
      expect(['http:', 'https:']).toContain(url.protocol)
    }
  })

  test('объявленные origin похожи на origin, а не на адрес страницы', () => {
    for (const game of SEED_GAMES) {
      for (const origin of game.allowedOrigins) {
        // Origin — это схема, хост и порт, без пути. Иначе проверка в хендшейке
        // никогда не совпадёт, и игра просто не запустится.
        expect(origin).toMatch(/^https?:\/\/[^/]+$/)

        const url = new URL(origin)
        expect(url.pathname).toBe('/')
        expect(url.search).toBe('')
      }
    }
  })

  test('есть хотя бы одна запускаемая игра: иначе SDK негде проверить вживую', () => {
    expect(SEED_GAMES.some((game) => game.allowedOrigins.length > 0)).toBe(true)
  })

  test('origin эталонной игры указывает на её же адрес', () => {
    for (const game of SEED_GAMES) {
      if (game.allowedOrigins.length === 0) continue

      const embed = new URL(game.embedUrl)
      expect(game.allowedOrigins).toContain(embed.origin)
    }
  })
})
