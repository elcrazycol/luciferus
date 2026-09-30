import { describe, expect, test } from 'bun:test'
import { loginRequestSchema, registerRequestSchema, usernameSchema } from '../src/auth'
import { toFieldErrors } from '../src/errors'
import { negateDecimal, parseDecimal, toDecimal } from '../src/money'
import { ledgerQuerySchema } from '../src/wallet'

describe('деньги', () => {
  test('toDecimal округляет до двух знаков', () => {
    expect(toDecimal(1420.5)).toBe('1420.50')
    expect(toDecimal(0.1 + 0.2)).toBe('0.30')
    expect(toDecimal(10)).toBe('10.00')
  })

  test('toDecimal отказывается работать с не-числами', () => {
    expect(() => toDecimal(Number.NaN)).toThrow()
    expect(() => toDecimal(Number.POSITIVE_INFINITY)).toThrow()
  })

  test('negateDecimal делает ставку отрицательной и не удваивает минус', () => {
    expect(negateDecimal('25.00')).toBe('-25.00')
    expect(negateDecimal('-25.00')).toBe('25.00')
  })

  test('parseDecimal разбирает ответ API и не падает на мусоре', () => {
    expect(parseDecimal('250.00')).toBe(250)
    expect(parseDecimal('не число')).toBeNull()
  })
})

describe('схемы авторизации', () => {
  test('логин приводится к нижнему регистру и обрезается', () => {
    expect(usernameSchema.parse('  Player  ')).toBe('player')
  })

  test('логин не принимает кириллицу и пробелы', () => {
    expect(usernameSchema.safeParse('игрок').success).toBe(false)
    expect(usernameSchema.safeParse('my player').success).toBe(false)
    expect(usernameSchema.safeParse('ab').success).toBe(false)
  })

  test('регистрация требует пароль от 8 символов, вход — нет', () => {
    const base = { username: 'player', displayName: 'Игрок' }

    expect(registerRequestSchema.safeParse({ ...base, password: 'short' }).success).toBe(false)
    expect(registerRequestSchema.safeParse({ ...base, password: 'longenough' }).success).toBe(true)

    // Вход не должен подсказывать длину пароля: демо-аккаунт player имеет пароль из 6 символов.
    expect(loginRequestSchema.safeParse({ username: 'player', password: 'player' }).success).toBe(
      true,
    )
  })

  test('ошибки раскладываются по полям', () => {
    const result = registerRequestSchema.safeParse({
      username: 'a',
      displayName: '',
      password: 'x',
    })
    expect(result.success).toBe(false)
    if (result.success) return

    const errors = toFieldErrors(result.error)
    expect(Object.keys(errors).sort()).toEqual(['displayName', 'password', 'username'])
  })
})

describe('схема запроса истории', () => {
  test('limit ограничен и имеет значение по умолчанию', () => {
    expect(ledgerQuerySchema.parse({}).limit).toBe(20)
    expect(ledgerQuerySchema.safeParse({ limit: '1000' }).success).toBe(false)
    expect(ledgerQuerySchema.safeParse({ limit: '0' }).success).toBe(false)
  })

  test('курсор должен быть UUID', () => {
    expect(ledgerQuerySchema.safeParse({ cursor: 'не-uuid' }).success).toBe(false)
    expect(
      ledgerQuerySchema.safeParse({ cursor: '3f1a5b8e-2c4d-4f6a-9b0e-1d2c3b4a5f60' }).success,
    ).toBe(true)
  })
})
