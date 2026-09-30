/**
 * Валюта платформы — единственное место, где она определена.
 *
 * CrazyBucks (C$) не имеют стоимости: их нельзя купить, продать, обменять или вывести.
 * Форк может переименовать валюту, изменив только этот файл: UI, API, SDK и леджер
 * читают значения отсюда.
 */
export const currency = {
  /** Внутренний код (не ISO 4217 — намеренно, это не фиат). */
  code: 'CBK',
  name: 'CrazyBucks',
  symbol: 'C$',
  /** Знаков после запятой. Должно совпадать с numeric(18, scale) в БД. */
  decimals: 2,
  /** Всегда true. Если кто-то поставит false — это уже не тот проект. */
  isSimulation: true,
} as const

export type Currency = typeof currency

/**
 * Форматирует сумму для UI: `1420.5` → `C$1,420.50`.
 * Принимает строку, потому что суммы из Postgres приходят как numeric → string.
 */
export function formatAmount(
  amount: number | string | null | undefined,
  options: { withSymbol?: boolean } = {},
): string {
  const { withSymbol = true } = options
  const parsed = typeof amount === 'string' ? Number.parseFloat(amount) : amount
  const value = typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0

  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  })

  return withSymbol ? `${currency.symbol}${formatted}` : formatted
}
