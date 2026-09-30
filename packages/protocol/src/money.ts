/**
 * Работа с денежными величинами.
 *
 * Деньги везде ходят строками: Postgres хранит их как `numeric(18,2)`, и если
 * прогнать сумму через `number` дважды, рано или поздно всплывёт `0.30000000000000004`.
 * Числа допустимы только на входе от клиента — и сразу же превращаются в строку.
 */

/**
 * Приводит число к десятичной строке с двумя знаками: `1420.5` → `'1420.50'`.
 * Бросает на нечисловых значениях — молча превращать мусор в `'0.00'` нельзя.
 */
export function toDecimal(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Ожидалось конечное число, получено: ${value}`)
  }

  return (Math.round(value * 100) / 100).toFixed(2)
}

/** Разбирает сумму из ответа API. Возвращает `null`, если строка не является числом. */
export function parseDecimal(value: string): number | null {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Ставка — это отрицательное движение баланса: `bet('25.00')` → `'-25.00'`. */
export function negateDecimal(value: string): string {
  return value.startsWith('-') ? value.slice(1) : `-${value}`
}
