import {
  FAIR_MODES,
  GAME_CATEGORIES,
  GAME_SORTS,
  GAME_VOLATILITIES,
  type GameListQuery,
} from '@luciferus/protocol/game'

export const CATALOG_PAGE_SIZE = 12

export type RawSearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Приводит параметры URL к тому, что API точно примет.
 *
 * Портал не пересылает пользовательский ввод в API как есть. Иначе `?sort=что-угодно`
 * превращался бы в 400, и человек вместо каталога видел бы ошибку — при том что он
 * просто подправил адрес в строке браузера. Неизвестные значения молча отбрасываются.
 */
export function sanitizeCatalogParams(params: RawSearchParams): GameListQuery {
  const rawFairMode = first(params.fairMode)

  return {
    category: GAME_CATEGORIES.find((value) => value === first(params.category)),
    sort: GAME_SORTS.find((value) => value === first(params.sort)) ?? 'title',
    volatility: GAME_VOLATILITIES.find((value) => value === first(params.volatility)),
    fairMode: FAIR_MODES.find((value) => value === rawFairMode),
    provider: first(params.provider)?.slice(0, 48) || undefined,
    search: first(params.search)?.trim().slice(0, 64) || undefined,
    limit: CATALOG_PAGE_SIZE,
    offset: Math.max(0, Number.parseInt(first(params.offset) ?? '0', 10) || 0),
  }
}
