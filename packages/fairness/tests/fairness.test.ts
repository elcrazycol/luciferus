import { describe, expect, test } from 'bun:test'
import { createHash, createHmac } from 'node:crypto'
import { hmacSha256Hex, sha256Hex } from '../src/digest'
import {
  deriveRoundRandom,
  pickWeighted,
  randomFloats,
  roundMessage,
  serverSeedHash,
  verifyRound,
} from '../src/round'

/**
 * Тесты криптографии против известных векторов.
 *
 * Это самый важный файл фазы: если SHA-256 или HMAC считает неправильно,
 * «проверяемая честность» становится декорацией. Самодельная реализация тут не
 * написана, но проверить, что WebCrypto подключён правильно и формат сообщения
 * не поехал, — обязательно.
 */

const POWERS_OF_TWO = String.fromCharCode(...new Uint8Array(20).fill(0x0b))

describe('SHA-256', () => {
  test('пустая строка', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  test('abc', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  test('длинная строка', async () => {
    expect(await sha256Hex('The quick brown fox jumps over the lazy dog')).toBe(
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    )
  })

  test('кириллица и эмодзи не ломают хэш', async () => {
    const hash = await sha256Hex('Люцифер 🎰')
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    // Тот же вход — тот же хэш, независимо от вызова.
    expect(await sha256Hex('Люцифер 🎰')).toBe(hash)
  })
})

describe('HMAC-SHA256', () => {
  test('классический пример из RFC', async () => {
    expect(await hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog')).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    )
  })

  test('RFC 4231, случай 1: ключ из 20 байт 0x0b', async () => {
    expect(await hmacSha256Hex(POWERS_OF_TWO, 'Hi There')).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    )
  })

  test('RFC 4231, случай 2: короткий ключ', async () => {
    expect(await hmacSha256Hex('Jefe', 'what do ya want for nothing?')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    )
  })

  /**
   * Векторы RFC с байтами выше 0x7f сюда не годятся: наш API принимает строку и
   * кодирует её в UTF-8, поэтому `0xaa` уехал бы двумя байтами. Вместо фиксированного
   * вектора сверяемся с независимой реализацией из `node:crypto` — это строже:
   * проверяются произвольные входы, а не один заранее известный.
   */
  test('совпадает с независимой реализацией на разных входах', async () => {
    const cases: Array<[string, string]> = [
      ['k', ''],
      ['key', 'The quick brown fox jumps over the lazy dog'],
      ['Люцифер 🎰', 'ставка:42'],
      ['a'.repeat(1000), 'b'.repeat(1000)],
      ['seed-с-юникодом-🎰', 'клиент:123456'],
    ]

    for (const [key, message] of cases) {
      const ours = await hmacSha256Hex(key, message)
      const theirs = createHmac('sha256', key).update(message).digest('hex')
      expect(ours).toBe(theirs)
    }
  })

  /**
   * WebCrypto отказывается работать с пустым ключом, а Node — нет. Если бы мы это
   * не поймали, проверка раунда проходила бы на сервере и падала в браузере, то
   * есть ровно там, где игрок проверяет честность. Отказ сделан явным.
   */
  test('пустой ключ отклоняется с понятной ошибкой, а не падает в браузере', async () => {
    expect(() => hmacSha256Hex('', 'message')).toThrow(TypeError)
    expect(() => hmacSha256Hex('', 'message')).toThrow('Ключ HMAC не может быть пустым')

    // Пустое сообщение при непустом ключе — допустимо.
    expect(await hmacSha256Hex('key', '')).toBe(
      createHmac('sha256', 'key').update('').digest('hex'),
    )
  })

  test('SHA-256 тоже совпадает с независимой реализацией', async () => {
    for (const value of ['', 'abc', 'Люцифер 🎰', 'x'.repeat(5000)]) {
      expect(await sha256Hex(value)).toBe(createHash('sha256').update(value).digest('hex'))
    }
  })

  test('разные ключи дают разные подписи на одном сообщении', async () => {
    const first = await hmacSha256Hex('seed-1', 'client:1')
    const second = await hmacSha256Hex('seed-2', 'client:1')
    expect(first).not.toBe(second)
  })
})

describe('формат сообщения раунда', () => {
  /**
   * Формат — часть контракта проверки. Если он поменяется случайно, все
   * опубликованные раунды станут неверифицируемыми.
   */
  test('склеивается из клиентского сида и номера через двоеточие', () => {
    expect(roundMessage('client-seed', 7)).toBe('client-seed:7')
    expect(roundMessage('', 0)).toBe(':0')
  })

  test('вывод случайности совпадает с HMAC от этого сообщения', async () => {
    const serverSeed = 'server-seed-значение'
    const clientSeed = 'client-seed'

    for (const nonce of [0, 1, 42, 999_999]) {
      const derived = await deriveRoundRandom({ serverSeed, clientSeed, nonce })
      const manual = await hmacSha256Hex(serverSeed, roundMessage(clientSeed, nonce))

      expect(derived).toBe(manual)
      expect(derived).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  test('разные nonce дают разную случайность', async () => {
    const seen = new Set<string>()

    for (let nonce = 0; nonce < 50; nonce += 1) {
      seen.add(await deriveRoundRandom({ serverSeed: 's', clientSeed: 'c', nonce }))
    }

    expect(seen.size).toBe(50)
  })

  test('смена клиентского сида меняет случайность', async () => {
    const first = await deriveRoundRandom({ serverSeed: 's', clientSeed: 'a', nonce: 1 })
    const second = await deriveRoundRandom({ serverSeed: 's', clientSeed: 'b', nonce: 1 })

    expect(first).not.toBe(second)
  })
})

describe('коммит серверного сида', () => {
  test('хэш детерминирован и не раскрывает сид', async () => {
    const serverSeed = 'очень-секретный-сид'
    const hash = await serverSeedHash(serverSeed)

    expect(hash).toHaveLength(64)
    expect(hash).not.toContain(serverSeed)
    expect(await serverSeedHash(serverSeed)).toBe(hash)
  })
})

describe('randomFloats', () => {
  const random = 'a'.repeat(64)

  test('значения лежат в [0, 1)', () => {
    const values = randomFloats(random, 3)

    expect(values).toHaveLength(3)
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  test('детерминированность: те же данные — те же числа', () => {
    expect(randomFloats(random, 3)).toEqual(randomFloats(random, 3))
  })

  test('разные куски хэша дают разные числа', () => {
    const values = randomFloats('0123456789abcdef'.repeat(4), 4)
    expect(new Set(values).size).toBeGreaterThan(1)
  })

  test('нуль значений — пустой массив', () => {
    expect(randomFloats(random, 0)).toEqual([])
  })

  test('не-hex вход отклоняется', () => {
    expect(() => randomFloats('не-hex', 1)).toThrow(TypeError)
    expect(() => randomFloats('', 1)).toThrow(TypeError)
  })

  test('слишком много значений отклоняется, а не считается неточно', () => {
    // 8 hex на значение — максимум 8 значений из 64 символов.
    expect(() => randomFloats(random, 20)).toThrow(RangeError)
    expect(() => randomFloats(random, 17)).toThrow(RangeError)
  })

  test('до 16 значений при минимальном размере куска', () => {
    expect(randomFloats(random, 16)).toHaveLength(16)
  })

  test('верхняя граница куска не даёт единицу', () => {
    // 'f'.repeat(64) — максимальное значение каждого куска.
    for (const value of randomFloats('f'.repeat(64), 8)) {
      expect(value).toBeLessThan(1)
    }
  })
})

describe('pickWeighted', () => {
  const items = [
    { item: 'common', weight: 90 },
    { item: 'rare', weight: 10 },
  ]

  test('границы весов соблюдаются точно', () => {
    // Веса 90 и 10: [0, 0.9) — common, [0.9, 1) — rare.
    expect(pickWeighted(items, 0)).toBe('common')
    expect(pickWeighted(items, 0.899999)).toBe('common')
    expect(pickWeighted(items, 0.9)).toBe('rare')
    expect(pickWeighted(items, 0.999999)).toBe('rare')
  })

  test('значение вне диапазона зажимается, а не ломает выбор', () => {
    expect(pickWeighted(items, -5)).toBe('common')
    expect(pickWeighted(items, 5)).toBe('rare')
  })

  test('распределение на равномерных значениях соответствует весам', () => {
    const counts = new Map<string, number>()
    const runs = 10_000

    for (let index = 0; index < runs; index += 1) {
      const picked = pickWeighted(items, index / runs)
      counts.set(picked, (counts.get(picked) ?? 0) + 1)
    }

    expect(counts.get('common')).toBe(9_000)
    expect(counts.get('rare')).toBe(1_000)
  })

  test('пустой список и нулевые веса отклоняются', () => {
    expect(() => pickWeighted([], 0.5)).toThrow(RangeError)
    expect(() => pickWeighted([{ item: 'a', weight: 0 }], 0.5)).toThrow(RangeError)
  })

  test('работает с одним элементом', () => {
    expect(pickWeighted([{ item: 'only', weight: 1 }], 0.5)).toBe('only')
  })
})

describe('verifyRound', () => {
  const serverSeed = 'server-seed'
  const clientSeed = 'client-seed'
  const nonce = 5

  async function fixture() {
    const hash = await serverSeedHash(serverSeed)
    const random = await deriveRoundRandom({ serverSeed, clientSeed, nonce })
    return { hash, random }
  }

  test('честный раунд проходит обе проверки', async () => {
    const { hash, random } = await fixture()

    const result = await verifyRound({
      serverSeed,
      serverSeedHash: hash,
      clientSeed,
      nonce,
      claimedRandom: random,
    })

    expect(result.seedMatchesCommit).toBe(true)
    expect(result.randomMatches).toBe(true)
    expect(result.computedRandom).toBe(random)
  })

  test('подменённый серверный сид ломает обе проверки', async () => {
    const { hash, random } = await fixture()

    const result = await verifyRound({
      serverSeed: 'другой-сид',
      serverSeedHash: hash,
      clientSeed,
      nonce,
      claimedRandom: random,
    })

    expect(result.seedMatchesCommit).toBe(false)
    expect(result.randomMatches).toBe(false)
  })

  test('подкрученный хэш коммита ловится', async () => {
    const { random } = await fixture()

    const result = await verifyRound({
      serverSeed,
      serverSeedHash: 'подставной-хэш',
      clientSeed,
      nonce,
      claimedRandom: random,
    })

    expect(result.seedMatchesCommit).toBe(false)
    // Случайность при этом сходится: правила игры остались прежними, а вот коммит — нет.
    expect(result.randomMatches).toBe(true)
  })

  test('неверный номер раунда ломает проверку случайности', async () => {
    const { hash, random } = await fixture()

    const result = await verifyRound({
      serverSeed,
      serverSeedHash: hash,
      clientSeed,
      nonce: nonce + 1,
      claimedRandom: random,
    })

    expect(result.seedMatchesCommit).toBe(true)
    expect(result.randomMatches).toBe(false)
  })

  test('подменённый клиентский сид ломает проверку случайности', async () => {
    const { hash, random } = await fixture()

    const result = await verifyRound({
      serverSeed,
      serverSeedHash: hash,
      clientSeed: 'чужой-клиентский-сид',
      nonce,
      claimedRandom: random,
    })

    expect(result.randomMatches).toBe(false)
  })

  test('регистр хэшей не важен', async () => {
    const { hash, random } = await fixture()

    const result = await verifyRound({
      serverSeed,
      serverSeedHash: hash.toUpperCase(),
      clientSeed,
      nonce,
      claimedRandom: random.toUpperCase(),
    })

    expect(result.seedMatchesCommit).toBe(true)
    expect(result.randomMatches).toBe(true)
  })

  test('пересчёт идемпотентен', async () => {
    const { hash, random } = await fixture()
    const input = { serverSeed, serverSeedHash: hash, clientSeed, nonce, claimedRandom: random }

    expect(await verifyRound(input)).toEqual(await verifyRound(input))
  })
})
