import { pickWeighted, randomFloats } from '@luciferus/fairness'

/**
 * Математика слота — чистая, без DOM и без SDK.
 *
 * Вынесено отдельно, чтобы таблицу выплат можно было проверить тестом: RTP
 * считается перебором всех 64 комбинаций барабанов, а не «на глазок» и не
 * симуляцией. Симуляция дала бы дрожащую оценку, а тут — точное число.
 */

export type SymbolId = 'cherry' | 'bell' | 'gem' | 'seven'

export type SymbolDefinition = {
  id: SymbolId
  glyph: string
  /** Вес при выборе символа на барабане. Сумма весов — общий знаменатель. */
  weight: number
}

export const SYMBOLS: readonly SymbolDefinition[] = [
  { id: 'cherry', glyph: '🍒', weight: 45 },
  { id: 'bell', glyph: '🔔', weight: 30 },
  { id: 'gem', glyph: '💎', weight: 18 },
  { id: 'seven', glyph: '7️⃣', weight: 7 },
]

/** Во что играет символ, если их выпало три. */
const THREE_OF_A_KIND: Record<SymbolId, number> = {
  cherry: 4,
  bell: 8,
  gem: 25,
  seven: 150,
}

/** Во что играет символ, если их выпало ровно два. */
const TWO_OF_A_KIND: Partial<Record<SymbolId, number>> = {
  gem: 1.5,
  seven: 4,
}

const TOTAL_WEIGHT = SYMBOLS.reduce((sum, symbol) => sum + symbol.weight, 0)

export function symbolProbability(id: SymbolId): number {
  const symbol = SYMBOLS.find((candidate) => candidate.id === id)
  return symbol ? symbol.weight / TOTAL_WEIGHT : 0
}

/** Выбирает символ по взвешенному распределению. `random` возвращает [0, 1). */
export function pickSymbol(random: () => number = Math.random): SymbolId {
  let roll = random() * TOTAL_WEIGHT

  for (const symbol of SYMBOLS) {
    roll -= symbol.weight
    if (roll < 0) return symbol.id
  }

  // Достижимо только если random() вернул ровно 1 — но лучше вернуть хоть что-то.
  return SYMBOLS[SYMBOLS.length - 1]?.id ?? 'cherry'
}

/** Три барабана. Используется только для тестов распределения — в игре есть честный путь ниже. */
export function spin(random: () => number = Math.random): SymbolId[] {
  return [pickSymbol(random), pickSymbol(random), pickSymbol(random)]
}

/** Сколько барабанов. */
export const REEL_COUNT = 3

const WEIGHTED_SYMBOLS = SYMBOLS.map((symbol) => ({ item: symbol.id, weight: symbol.weight }))

/**
 * Исход раунда из случайности, выданной порталом.
 *
 * Это и есть весь «движок»: та же случайность при тех же весах всегда даёт те же
 * барабаны, поэтому проверяющий может повторить расчёт за игру. Никакого своего
 * рандома здесь быть не должно — иначе проверять было бы нечего.
 */
export function reelsFromRandom(randomHex: string): SymbolId[] {
  return randomFloats(randomHex, REEL_COUNT).map((value) => pickWeighted(WEIGHTED_SYMBOLS, value))
}

/** Во сколько раз ставка умножается на этом наборе. Ноль — проигрыш. */
export function evaluateMultiplier(reels: readonly SymbolId[]): number {
  const [first, second, third] = reels
  if (!first || !second || !third) return 0

  if (first === second && second === third) {
    return THREE_OF_A_KIND[first]
  }

  const counts = new Map<SymbolId, number>()
  for (const symbol of reels) {
    counts.set(symbol, (counts.get(symbol) ?? 0) + 1)
  }

  for (const [symbol, count] of counts) {
    if (count === 2) return TWO_OF_A_KIND[symbol] ?? 0
  }

  return 0
}

/**
 * Точный RTP: перебираем все комбинации и складываем вероятность × выплату.
 *
 * Значение обязано совпадать с тем, что заявлено на экране игры. Если кто-то
 * поправит таблицу выплат и забудет про RTP — упадёт тест.
 */
export function computeRtp(): number {
  let rtp = 0
  const ids = SYMBOLS.map((symbol) => symbol.id)

  for (const first of ids) {
    for (const second of ids) {
      for (const third of ids) {
        const probability =
          symbolProbability(first) * symbolProbability(second) * symbolProbability(third)

        rtp += probability * evaluateMultiplier([first, second, third])
      }
    }
  }

  return rtp
}

/** Заявленный RTP — округлённый до десятых долей процента точный расчёт. */
export const DECLARED_RTP = Math.round(computeRtp() * 1000) / 1000

/** Таблица выплат для экрана игры, чтобы не дублировать числа руками. */
export const PAYTABLE_DISPLAY: ReadonlyArray<{ glyphs: string; multiplier: number }> = [
  { glyphs: '7️⃣ 7️⃣ 7️⃣', multiplier: THREE_OF_A_KIND.seven },
  { glyphs: '💎 💎 💎', multiplier: THREE_OF_A_KIND.gem },
  { glyphs: '🔔 🔔 🔔', multiplier: THREE_OF_A_KIND.bell },
  { glyphs: '🍒 🍒 🍒', multiplier: THREE_OF_A_KIND.cherry },
  { glyphs: '7️⃣ 7️⃣ ·', multiplier: TWO_OF_A_KIND.seven ?? 0 },
  { glyphs: '💎 💎 ·', multiplier: TWO_OF_A_KIND.gem ?? 0 },
]
