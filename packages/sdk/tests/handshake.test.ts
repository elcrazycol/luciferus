import { describe, expect, test } from 'bun:test'
import { EMBED_PROTOCOL_VERSION } from '@luciferus/protocol/embed-constants'
import { CasinoError } from '../src/errors'
import { createPostMessageTransport } from '../src/transports/post-message'
import type { MessageEventLike, TransportSession, WindowLike } from '../src/types'

const PORTAL_ORIGIN = 'https://portal.test'
const GAME_ORIGIN = 'https://game.test'
const TOKEN = 'game-token-abc'

function initMessage(nonce = 'nonce-1') {
  return {
    type: 'casino:init',
    protocol: EMBED_PROTOCOL_VERSION,
    nonce,
    gameSlug: 'lucky-7s',
    portalOrigin: PORTAL_ORIGIN,
  }
}

function sessionMessage(overrides: Record<string, unknown> = {}) {
  return {
    type: 'casino:session',
    protocol: EMBED_PROTOCOL_VERSION,
    nonce: 'nonce-1',
    gameSlug: 'lucky-7s',
    apiUrl: 'https://api.test',
    session: { token: TOKEN, expiresAt: '2030-01-01T00:00:00.000Z' },
    player: { id: 'u1', username: 'player', displayName: 'Игрок' },
    wallet: { balance: '250.00', currency: 'CBK' },
    limits: { minBet: 0.1, maxBet: 100, maxWin: 5000 },
    ...overrides,
  }
}

type Harness = {
  transport: ReturnType<typeof createPostMessageTransport>
  toParent: Array<{ message: Record<string, unknown>; targetOrigin: string }>
  fetchCalls: Array<{ url: string; init: RequestInit }>
  deliver: (data: unknown, overrides?: { origin?: string; source?: unknown }) => void
  listenerCount: () => number
  respond: (status: number, body: unknown) => void
}

function createHarness(options: { initTimeoutMs?: number; embedded?: boolean } = {}): Harness {
  type Listener = (event: MessageEventLike) => void

  const listeners = new Set<Listener>()
  const toParent: Array<{ message: Record<string, unknown>; targetOrigin: string }> = []
  const fetchCalls: Array<{ url: string; init: RequestInit }> = []

  let apiResponse: { status: number; body: unknown } = { status: 200, body: {} }

  const parent: WindowLike = {
    postMessage(message, targetOrigin) {
      toParent.push({ message: message as Record<string, unknown>, targetOrigin })
    },
  }

  const self: WindowLike = {
    postMessage() {},
    addEventListener(_type, listener) {
      listeners.add(listener)
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener)
    },
  }

  const transport = createPostMessageTransport({
    self,
    parent: options.embedded === false ? null : parent,
    fetchFn: async (url, init) => {
      fetchCalls.push({ url, init })
      return new Response(JSON.stringify(apiResponse.body), {
        status: apiResponse.status,
        headers: { 'content-type': 'application/json' },
      })
    },
    setTimeoutFn: (handler, ms) => setTimeout(handler, ms),
    clearTimeoutFn: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    sdkVersion: '1.0.0',
    capabilities: ['wallet'],
    initTimeoutMs: options.initTimeoutMs ?? 1000,
  })

  return {
    transport,
    toParent,
    fetchCalls,
    listenerCount: () => listeners.size,
    respond: (status, body) => {
      apiResponse = { status, body }
    },
    deliver: (data, overrides = {}) => {
      const event: MessageEventLike = {
        data,
        origin: overrides.origin ?? PORTAL_ORIGIN,
        source: overrides.source ?? parent,
      }

      for (const listener of [...listeners]) listener(event)
    },
  }
}

function createHandlers() {
  const balances: string[] = []
  const errors: Error[] = []

  return {
    balances,
    errors,
    handlers: {
      onBalance: (balance: string) => balances.push(balance),
      onError: (error: Error) => errors.push(error),
    },
  }
}

/** Ждёт `ms` миллисекунд — чтобы проверить, что промис всё ещё не разрешился. */
function pending<T>(promise: Promise<T>, ms = 30): Promise<T | 'pending'> {
  return Promise.race([
    promise,
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), ms)),
  ])
}

describe('создание транспорта', () => {
  test('вне фрейма транспорт не создаётся', () => {
    const harness = createHarness({ embedded: false })
    expect(harness.transport).toBeNull()
  })
})

describe('хендшейк', () => {
  test('отвечает на init приветствием с тем же nonce', async () => {
    const harness = createHarness()
    const ready = harness.transport?.ready(createHandlers().handlers)

    harness.deliver(initMessage('nonce-42'))

    expect(harness.toParent).toHaveLength(1)

    const hello = harness.toParent[0]
    expect(hello?.message.type).toBe('casino:hello')
    expect(hello?.message.nonce).toBe('nonce-42')
    expect(hello?.message.sdkVersion).toBe('1.0.0')
    expect(hello?.message.capabilities).toEqual(['wallet'])

    // Ключевое: игра адресует ответ ТОЧНО порталу, а не в `*`.
    expect(hello?.targetOrigin).toBe(PORTAL_ORIGIN)

    harness.deliver(sessionMessage())
    await ready
  })

  test('не отвечает на init от постороннего окна', async () => {
    const harness = createHarness()
    void harness.transport?.ready(createHandlers().handlers)

    harness.deliver(initMessage(), { source: { postMessage() {} } })

    expect(harness.toParent).toHaveLength(0)
  })

  test('не принимает сессию с чужого origin', async () => {
    const harness = createHarness({ initTimeoutMs: 5000 })
    const captured = createHandlers()
    const ready = harness.transport?.ready(captured.handlers)

    harness.deliver(initMessage())
    // Сообщение с правильным source и содержимым, но не с того домена.
    harness.deliver(sessionMessage(), { origin: 'https://evil.test' })

    expect(await pending(ready as Promise<TransportSession>)).toBe('pending')
    expect(captured.errors).toHaveLength(0)
  })

  test('не принимает сессию от другого окна, даже с верного origin', async () => {
    const harness = createHarness({ initTimeoutMs: 5000 })
    const ready = harness.transport?.ready(createHandlers().handlers)

    harness.deliver(initMessage())
    harness.deliver(sessionMessage(), { source: { postMessage() {} } })

    expect(await pending(ready as Promise<TransportSession>)).toBe('pending')
  })

  test('принимает настоящую сессию и отдаёт состояние', async () => {
    const harness = createHarness()
    const ready = harness.transport?.ready(createHandlers().handlers)

    harness.deliver(initMessage())
    harness.deliver(sessionMessage())

    const session = await ready
    expect(session?.balance).toBe('250.00')
    expect(session?.player?.displayName).toBe('Игрок')
    expect(session?.limits.maxBet).toBe(100)
    expect(harness.transport?.gameSlug).toBe('lucky-7s')
  })

  test('падает по таймауту, если портал молчит', async () => {
    const harness = createHarness({ initTimeoutMs: 10 })
    const ready = harness.transport?.ready(createHandlers().handlers)

    await expect(ready).rejects.toThrow(/Портал не ответил/)

    try {
      await ready
    } catch (error) {
      expect((error as CasinoError).code).toBe('handshake_timeout')
    }
  })

  test('сообщение портала об ошибке доходит до игры', async () => {
    const harness = createHarness({ initTimeoutMs: 5000 })
    const ready = harness.transport?.ready(createHandlers().handlers)

    harness.deliver(initMessage())
    harness.deliver({
      type: 'casino:error',
      protocol: EMBED_PROTOCOL_VERSION,
      code: 'game_disabled',
      message: 'Игра отключена',
    })

    await expect(ready).rejects.toThrow('Игра отключена')
  })

  test('сообщения чужой версии протокола игнорируются', async () => {
    const harness = createHarness({ initTimeoutMs: 5000 })
    const captured = createHandlers()
    const ready = harness.transport?.ready(captured.handlers)

    harness.deliver({ ...initMessage(), protocol: EMBED_PROTOCOL_VERSION + 1 })
    harness.deliver({ ...sessionMessage(), protocol: EMBED_PROTOCOL_VERSION + 1 })

    expect(await pending(ready as Promise<TransportSession>)).toBe('pending')
    expect(captured.errors).toHaveLength(0)
  })

  test('обновления баланса от портала доходят до обработчика', async () => {
    const harness = createHarness()
    const captured = createHandlers()
    const ready = harness.transport?.ready(captured.handlers)

    harness.deliver(initMessage())
    harness.deliver(sessionMessage())
    await ready

    harness.deliver({
      type: 'casino:balance',
      protocol: EMBED_PROTOCOL_VERSION,
      balance: '150.00',
    })

    expect(captured.balances).toEqual(['150.00'])
  })
})

describe('обращения к API', () => {
  test('ходят с игровым токеном в заголовке', async () => {
    const harness = createHarness()
    const ready = harness.transport?.ready(createHandlers().handlers)

    harness.deliver(initMessage())
    harness.deliver(sessionMessage())
    await ready

    harness.respond(200, {
      balance: '240.00',
      entry: { amount: '-10.00', roundId: 'r1' },
      idempotent: false,
    })

    const result = await harness.transport?.bet({ amount: 10, roundId: 'r1' })

    expect(harness.fetchCalls).toHaveLength(1)
    expect(harness.fetchCalls[0]?.url).toBe('https://api.test/v1/game/bet')

    const headers = harness.fetchCalls[0]?.init.headers as Record<string, string>
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`)

    expect(result?.balance).toBe('240.00')
    expect(result?.amount).toBe('-10.00')
  })

  test('ошибка API превращается в CasinoError с кодом', async () => {
    const harness = createHarness()
    const ready = harness.transport?.ready(createHandlers().handlers)

    harness.deliver(initMessage())
    harness.deliver(sessionMessage())
    await ready

    harness.respond(402, { error: 'insufficient_funds', message: 'Мало денег' })

    try {
      await harness.transport?.bet({ amount: 999, roundId: 'r1' })
      throw new Error('ожидалась ошибка')
    } catch (error) {
      expect(error).toBeInstanceOf(CasinoError)
      expect((error as CasinoError).code).toBe('insufficient_funds')
      expect((error as CasinoError).status).toBe(402)
    }
  })

  test('сетевой сбой не превращается в непонятную ошибку', async () => {
    const harness = createHarness()
    const ready = harness.transport?.ready(createHandlers().handlers)

    harness.deliver(initMessage())
    harness.deliver(sessionMessage())
    await ready

    // Ломаем fetch после успешного хендшейка.
    const broken = createPostMessageTransport({
      self: { postMessage() {}, addEventListener() {}, removeEventListener() {} },
      parent: { postMessage() {} },
      fetchFn: async () => {
        throw new TypeError('Failed to fetch')
      },
      setTimeoutFn: (handler, ms) => setTimeout(handler, ms),
      clearTimeoutFn: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      sdkVersion: '1.0.0',
    })

    expect(broken).not.toBeNull()
    await expect(broken?.refresh()).rejects.toThrow()
  })
})

describe('жизненный цикл', () => {
  test('dispose снимает слушатель', async () => {
    const harness = createHarness()
    expect(harness.listenerCount()).toBe(0)

    void harness.transport?.ready(createHandlers().handlers)
    expect(harness.listenerCount()).toBe(1)

    harness.transport?.dispose()
    expect(harness.listenerCount()).toBe(0)

    // После dispose сообщения больше не обрабатываются.
    harness.deliver(initMessage())
    expect(harness.toParent).toHaveLength(0)
  })
})

describe('игровой домен', () => {
  test('origin игры нигде не подставляется — только origin портала', async () => {
    const harness = createHarness()
    void harness.transport?.ready(createHandlers().handlers)

    harness.deliver(initMessage())

    const targets = harness.toParent.map((entry) => entry.targetOrigin)
    expect(targets).not.toContain(GAME_ORIGIN)
    expect(targets).not.toContain('*')
    expect(targets).toEqual([PORTAL_ORIGIN])
  })
})
