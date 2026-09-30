import { describe, expect, test } from 'bun:test'
import { buildCatalogQuery } from '../src/lib/api'
import { CATALOG_PAGE_SIZE, sanitizeCatalogParams } from '../src/lib/catalog-params'

/**
 * Параметры каталога приходят прямо из адресной строки, то есть от пользователя.
 * Портал обязан превратить их в валидный запрос к API, а не упасть.
 */

describe('разбор параметров каталога', () => {
  test('пустой адрес даёт каталог по умолчанию', () => {
    const query = sanitizeCatalogParams({})

    expect(query).toEqual({
      category: undefined,
      sort: 'title',
      volatility: undefined,
      fairMode: undefined,
      provider: undefined,
      search: undefined,
      limit: CATALOG_PAGE_SIZE,
      offset: 0,
    })
  })

  test('известные значения сохраняются', () => {
    const query = sanitizeCatalogParams({
      category: 'crash',
      sort: 'plays',
      volatility: 'high',
      fairMode: 'provably-fair',
      provider: 'luciferus-originals',
      search: '  слот  ',
    })

    expect(query.category).toBe('crash')
    expect(query.sort).toBe('plays')
    expect(query.volatility).toBe('high')
    expect(query.fairMode).toBe('provably-fair')
    expect(query.provider).toBe('luciferus-originals')
    // Пробелы по краям обрезаются, иначе поиск « слот » ничего не найдёт.
    expect(query.search).toBe('слот')
  })

  test('неизвестные значения отбрасываются, а не ломают запрос', () => {
    const query = sanitizeCatalogParams({
      category: 'выдуманная',
      sort: 'по-всему',
      volatility: 'экстремальная',
      fairMode: 'честный',
    })

    expect(query.category).toBeUndefined()
    expect(query.sort).toBe('title')
    expect(query.volatility).toBeUndefined()
    expect(query.fairMode).toBeUndefined()
  })

  test('смещение приводится к безопасному числу', () => {
    expect(sanitizeCatalogParams({ offset: '-50' }).offset).toBe(0)
    expect(sanitizeCatalogParams({ offset: 'мусор' }).offset).toBe(0)
    expect(sanitizeCatalogParams({ offset: '24' }).offset).toBe(24)
    expect(sanitizeCatalogParams({ offset: '2.7' }).offset).toBe(2)
  })

  test('повторяющиеся параметры берут первый', () => {
    expect(sanitizeCatalogParams({ category: ['crash', 'slots'] }).category).toBe('crash')
  })

  test('длинный ввод обрезается, а не улетает в API', () => {
    const query = sanitizeCatalogParams({
      search: 'x'.repeat(500),
      provider: 'y'.repeat(200),
    })

    expect(query.search?.length).toBe(64)
    expect(query.provider?.length).toBe(48)
  })

  test('пустые строки не превращаются в фильтры', () => {
    const query = sanitizeCatalogParams({ search: '   ', provider: '', category: '' })

    expect(query.search).toBeUndefined()
    expect(query.provider).toBeUndefined()
    expect(query.category).toBeUndefined()
  })
})

describe('сборка строки запроса', () => {
  test('пустые значения не попадают в адрес', () => {
    const query = buildCatalogQuery({
      sort: 'title',
      limit: 12,
      offset: 0,
      category: undefined,
      search: '',
    })

    expect(query).toBe('sort=title&limit=12&offset=0')
  })

  test('кириллица кодируется', () => {
    const query = buildCatalogQuery({ search: 'слот' })
    expect(query).toContain('search=')
    expect(decodeURIComponent(query.replace('search=', ''))).toBe('слот')
  })
})
