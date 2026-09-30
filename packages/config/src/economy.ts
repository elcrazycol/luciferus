/**
 * Экономика платформы: бонусы, кулдауны, пороги. Значения по умолчанию здесь,
 * переопределяются переменными окружения (см. packages/config/src/server.ts).
 */
export const economy = {
  /** Стартовый бонус при регистрации. */
  signupBonus: 250,
  /** Сумма дозаправки баланса. */
  reloadBonus: 100,
  /** Как часто можно дозаправляться. */
  reloadCooldownMinutes: 15,
  /** Ниже этого баланса кнопка «Reload Bonus» становится доступной. */
  reloadThreshold: 10,
  /** Максимальный размер ставки по умолчанию для игры без своих лимитов. */
  defaultMaxBet: 100,
  /** Максимальный выигрыш за раунд по умолчанию. */
  defaultMaxWin: 5000,
} as const

export type Economy = typeof economy
