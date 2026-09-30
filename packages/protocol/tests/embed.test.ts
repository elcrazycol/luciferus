import { describe, expect, test } from 'bun:test'
import {
  EMBED_PROTOCOL_VERSION,
  isEmbedEnvelope,
  isOriginAllowed,
  readBalanceMessage,
  readErrorMessage,
  readHelloMessage,
  readInitMessage,
  readSessionMessage,
} from '../src/embed'

const hello = {
  type: 'casino:hello',
  protocol: EMBED_PROTOCOL_VERSION,
  nonce: 'n-1',
  gameSlug: 'lucky-7s',
  sdkVersion: '1.0.0',
  capabilities: ['wallet'],
}

describe('конверт протокола', () => {
  test('принимает сообщения своей версии', () => {
    expect(isEmbedEnvelope(hello)).toBe(true)
  })

  test('отвергает чужие сообщения без лишнего шума', () => {
    expect(isEmbedEnvelope(null)).toBe(false)
    expect(isEmbedEnvelope('строка')).toBe(false)
    expect(isEmbedEnvelope([])).toBe(false)
    expect(isEmbedEnvelope({ type: 'casino:hello' })).toBe(false)
    // Сообщение из будущей версии протокола: молча игнорируем, а не падаем.
    expect(isEmbedEnvelope({ ...hello, protocol: EMBED_PROTOCOL_VERSION + 1 })).toBe(false)
  })
})

describe('чтение hello', () => {
  test('разбирает корректное сообщение', () => {
    const parsed = readHelloMessage(hello)
    expect(parsed?.nonce).toBe('n-1')
    expect(parsed?.gameSlug).toBe('lucky-7s')
    expect(parsed?.capabilities).toEqual(['wallet'])
  })

  test('отбрасывает сообщение без nonce', () => {
    expect(readHelloMessage({ ...hello, nonce: '' })).toBeNull()
    expect(readHelloMessage({ ...hello, nonce: 42 })).toBeNull()
  })

  test('отбрасывает сообщение без обязательных полей', () => {
    expect(readHelloMessage({ ...hello, gameSlug: undefined })).toBeNull()
    expect(readHelloMessage({ ...hello, sdkVersion: undefined })).toBeNull()
  })

  test('терпим к мусору в необязательных полях', () => {
    // Возможности — вещь расширяемая: незнакомые строки отфильтровываются,
    // а не ломают хендшейк.
    const parsed = readHelloMessage({ ...hello, capabilities: ['wallet', 42, null, 'chat'] })
    expect(parsed?.capabilities).toEqual(['wallet', 'chat'])
  })

  test('подменённый тип не проходит', () => {
    expect(readHelloMessage({ ...hello, type: 'casino:init' })).toBeNull()
  })
})

describe('чтение init', () => {
  test('разбирает корректный init', () => {
    const parsed = readInitMessage({
      type: 'casino:init',
      protocol: EMBED_PROTOCOL_VERSION,
      nonce: 'n-2',
      gameSlug: 'crash-rocket',
      portalOrigin: 'https://portal.test',
    })

    expect(parsed?.portalOrigin).toBe('https://portal.test')
  })

  test('init без portalOrigin бесполезен и отбрасывается', () => {
    expect(
      readInitMessage({
        type: 'casino:init',
        protocol: EMBED_PROTOCOL_VERSION,
        nonce: 'n',
        gameSlug: 'g',
      }),
    ).toBeNull()
  })
})

describe('чтение сессии', () => {
  const session = {
    type: 'casino:session',
    protocol: EMBED_PROTOCOL_VERSION,
    nonce: 'n-1',
    gameSlug: 'lucky-7s',
    apiUrl: 'http://localhost:3001',
    session: { token: 'token', expiresAt: '2030-01-01T00:00:00.000Z' },
    player: { id: 'u1', username: 'player', displayName: 'Игрок' },
    wallet: { balance: '250.00', currency: 'CBK' },
    limits: { minBet: 0.1, maxBet: 100, maxWin: 5000 },
  }

  test('разбирает полную сессию', () => {
    const parsed = readSessionMessage(session)
    expect(parsed?.session.token).toBe('token')
    expect(parsed?.wallet.balance).toBe('250.00')
    expect(parsed?.limits.maxBet).toBe(100)
  })

  test('сессия без токена не принимается', () => {
    expect(readSessionMessage({ ...session, session: { expiresAt: 'x' } })).toBeNull()
  })

  test('сессия без адреса API не принимается', () => {
    expect(readSessionMessage({ ...session, apiUrl: '' })).toBeNull()
  })

  test('нечисловые лимиты превращаются в безопасные значения по умолчанию', () => {
    const parsed = readSessionMessage({ ...session, limits: { minBet: 'много' } })
    expect(parsed?.limits.minBet).toBe(0)
    expect(parsed?.limits.maxBet).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('баланс и ошибки', () => {
  test('баланс принимается только строкой', () => {
    expect(
      readBalanceMessage({
        type: 'casino:balance',
        protocol: EMBED_PROTOCOL_VERSION,
        balance: '10.00',
      })?.balance,
    ).toBe('10.00')

    expect(
      readBalanceMessage({ type: 'casino:balance', protocol: EMBED_PROTOCOL_VERSION, balance: 10 }),
    ).toBeNull()
  })

  test('неизвестный код ошибки не проходит как есть', () => {
    const parsed = readErrorMessage({
      type: 'casino:error',
      protocol: EMBED_PROTOCOL_VERSION,
      code: 'что-то-новое',
      message: 'boom',
    })

    expect(parsed?.code).toBe('internal_error')
  })

  test('известный код ошибки сохраняется', () => {
    const parsed = readErrorMessage({
      type: 'casino:error',
      protocol: EMBED_PROTOCOL_VERSION,
      code: 'origin_not_allowed',
      message: 'нет',
    })

    expect(parsed?.code).toBe('origin_not_allowed')
  })
})

describe('проверка origin', () => {
  test('совпадение только точное', () => {
    const allowed = ['https://game.example.com']

    expect(isOriginAllowed('https://game.example.com', allowed)).toBe(true)
    // Поддомен — другой origin, и это важно: иначе фишинг на поддомене
    // получил бы доступ к сессии.
    expect(isOriginAllowed('https://evil.game.example.com', allowed)).toBe(false)
    expect(isOriginAllowed('http://game.example.com', allowed)).toBe(false)
    expect(isOriginAllowed('https://game.example.com:8443', allowed)).toBe(false)
    expect(isOriginAllowed('', allowed)).toBe(false)
  })

  test('пустой список запрещает всё', () => {
    expect(isOriginAllowed('http://localhost:4000', [])).toBe(false)
  })

  test('localhost с портом — отдельный origin', () => {
    const allowed = ['http://localhost:4000']
    expect(isOriginAllowed('http://localhost:4000', allowed)).toBe(true)
    expect(isOriginAllowed('http://localhost:3000', allowed)).toBe(false)
  })
})
