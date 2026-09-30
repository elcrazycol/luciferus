import { describe, expect, test } from 'bun:test'
import {
  computeRtp,
  DECLARED_RTP,
  evaluateMultiplier,
  pickSymbol,
  reelsFromRandom,
  SYMBOLS,
  type SymbolId,
  spin,
} from '../src/slot'

describe('барабаны', () => {
  test('веса образуют осмысленное распределение', () => {
    const total = SYMBOLS.reduce((sum, symbol) => sum + symbol.weight, 0)
    expect(total).toBe(100)

    for (const symbol of SYMBOLS) {
      expect(symbol.weight).toBeGreaterThan(0)
    }
  })

  test('редкий символ выпадает реже частого', () => {
    const cherry = SYMBOLS.find((symbol) => symbol.id === 'cherry')
    const seven = SYMBOLS.find((symbol) => symbol.id === 'seven')

    expect(cherry?.weight ?? 0).toBeGreaterThan(seven?.weight ?? 0)
  })

  test('очень удачный random всё равно даёт корректный символ', () => {
    // random() по контракту возвращает [0, 1), но защита от ровно 1 должна быть.
    const ids = SYMBOLS.map((symbol) => symbol.id)
    expect(ids).toContain(pickSymbol(() => 0))
    expect(ids).toContain(pickSymbol(() => 0.999999))
    expect(ids).toContain(pickSymbol(() => 1))
  })

  test('spin с подставленным random детерминирован', () => {
    // 0 → первый символ (🍒), 0.99 → последний (7️⃣).
    expect(spin(() => 0)).toEqual(['cherry', 'cherry', 'cherry'])
    expect(spin(() => 0.999999)).toEqual(['seven', 'seven', 'seven'])
  })
})

describe('таблица выплат', () => {
  test('три одинаковых платят по таблице', () => {
    expect(evaluateMultiplier(['seven', 'seven', 'seven'])).toBe(150)
    expect(evaluateMultiplier(['gem', 'gem', 'gem'])).toBe(25)
    expect(evaluateMultiplier(['bell', 'bell', 'bell'])).toBe(8)
    expect(evaluateMultiplier(['cherry', 'cherry', 'cherry'])).toBe(4)
  })

  test('ровно два особых символа платят меньше', () => {
    expect(evaluateMultiplier(['seven', 'seven', 'cherry'])).toBe(4)
    expect(evaluateMultiplier(['gem', 'cherry', 'gem'])).toBe(1.5)
  })

  test('две вишни и два колокола ничего не платят', () => {
    expect(evaluateMultiplier(['cherry', 'cherry', 'bell'])).toBe(0)
    expect(evaluateMultiplier(['bell', 'bell', 'cherry'])).toBe(0)
  })

  test('три разных символа ничего не платят', () => {
    expect(evaluateMultiplier(['cherry', 'bell', 'gem'])).toBe(0)
  })

  test('порядок барабанов не важен для двух символов', () => {
    const variants: SymbolId[][] = [
      ['seven', 'seven', 'cherry'],
      ['seven', 'cherry', 'seven'],
      ['cherry', 'seven', 'seven'],
    ]

    for (const variant of variants) {
      expect(evaluateMultiplier(variant)).toBe(4)
    }
  })
})

describe('RTP', () => {
  /**
   * Главный тест математики. Если кто-то поправит выплаты и забудет про RTP,
   * слот начнёт отдавать больше, чем заявлено, — и это заметят не игроки, а тест.
   */
  test('точный RTP совпадает с заявленным', () => {
    expect(computeRtp()).toBeCloseTo(0.952, 3)
    expect(DECLARED_RTP).toBe(0.952)
  })

  test('RTP меньше единицы: слот не отдаёт больше, чем в него ставят', () => {
    expect(computeRtp()).toBeLessThan(1)
  })

  test('RTP достаточно высокий, чтобы игра не была заведомо убыточной', () => {
    expect(computeRtp()).toBeGreaterThan(0.9)
  })

  test('сумма вероятностей всех комбинаций равна единице', () => {
    const ids = SYMBOLS.map((symbol) => symbol.id)
    let total = 0

    for (const first of ids) {
      for (const second of ids) {
        for (const third of ids) {
          const probability =
            ((SYMBOLS.find((s) => s.id === first)?.weight ?? 0) / 100) *
            ((SYMBOLS.find((s) => s.id === second)?.weight ?? 0) / 100) *
            ((SYMBOLS.find((s) => s.id === third)?.weight ?? 0) / 100)
          total += probability
        }
      }
    }

    expect(total).toBeCloseTo(1, 10)
  })
})

describe('честность генератора', () => {
  test('частота символов на длинной дистанции близка к весам', () => {
    // Псевдослучайный генератор с фиксированным зерном: тест не должен мигать.
    let state = 123456789
    const random = () => {
      state = (state * 1103515245 + 12345) % 2147483648
      return state / 2147483648
    }

    const counts = new Map<SymbolId, number>()
    const runs = 120_000

    for (let index = 0; index < runs; index += 1) {
      for (const symbol of spin(random)) {
        counts.set(symbol, (counts.get(symbol) ?? 0) + 1)
      }
    }

    for (const symbol of SYMBOLS) {
      const expected = symbol.weight / 100
      const actual = (counts.get(symbol.id) ?? 0) / (runs * 3)
      expect(Math.abs(actual - expected)).toBeLessThan(0.01)
    }
  })
})

describe('исход из случайности портала', () => {
  test('детерминирован: одна случайность — одни барабаны', () => {
    const random = '9f3a'.repeat(16)
    expect(reelsFromRandom(random)).toEqual(reelsFromRandom(random))
  })

  test('всегда возвращает ровно три допустимых символа', () => {
    const ids = SYMBOLS.map((symbol) => symbol.id)

    for (const seed of ['0'.repeat(64), 'f'.repeat(64), 'a1b2c3d4'.repeat(8)]) {
      const reels = reelsFromRandom(seed)

      expect(reels).toHaveLength(3)
      for (const reel of reels) {
        expect(ids).toContain(reel)
      }
    }
  })

  test('разная случайность даёт разные наборы', () => {
    const seen = new Set<string>()

    // Хэш читается кусками, по одному на барабан, поэтому случайность обязана
    // различаться во всех кусках: меняя только первый, мы бы получили одни и те
    // же второй и третий барабаны.
    // `Math.imul` обязателен: обычное умножение выходит за пределы точности
    // JS-чисел и генератор вырождается в короткий цикл.
    let state = 987654321
    const nextChunk = () => {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0
      return state.toString(16).padStart(8, '0')
    }

    for (let index = 0; index < 40; index += 1) {
      const seed = Array.from({ length: 8 }, nextChunk).join('')
      seen.add(reelsFromRandom(seed).join('-'))
    }

    expect(seen.size).toBeGreaterThan(10)
  })

  test('крайние значения дают крайние символы', () => {
    // '0' — минимальные числа, 'f' — максимальные: проверяем, что таблица весов
    // действительно упорядочена от частого к редкому.
    expect(reelsFromRandom('0'.repeat(64))).toEqual(['cherry', 'cherry', 'cherry'])
    expect(reelsFromRandom('f'.repeat(64))).toEqual(['seven', 'seven', 'seven'])
  })

  test('не-hex случайность отклоняется', () => {
    expect(() => reelsFromRandom('не-случайность')).toThrow()
  })
})
