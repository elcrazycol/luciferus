import { describe, expect, test } from 'bun:test'
import { EMBED_PROTOCOL_VERSION, type GameLaunch } from '@luciferus/protocol/embed'
import { createPostMessageTransport } from '@luciferus/sdk/transports'
import { createEmbedBridge, type MessageEventLike } from '../src/lib/embed-bridge'

/**
 * Интеграционный тест протокола встраивания: портал и SDK запускаются вместе и
 * разговаривают друг с другом, как в браузере.
 *
 * Здесь нет DOM, но есть главное — семантика postMessage: доставка происходит
 * только при точном совпадении `targetOrigin`, а получатель видит origin и source
 * отправителя. На этой семантике держится вся защита, поэтому проверять её
 * «по-настоящему» важнее, чем гонять один SDK против заглушек.
 */

const PORTAL_ORIGIN = 'https://portal.test'
const GAME_ORIGIN = 'https://game.test'
const EVIL_ORIGIN = 'https://evil.test'
const TOKEN = 'game-token-abc'
const NONCE = 'nonce-fixed'
const SLUG = 'lucky-7s'

function createLaunch(overrides: Partial<GameLaunch['game']> = {}): GameLaunch {
  return {
    game: {
      slug: SLUG,
      title: 'Lucky 7s',
      embedUrl: `${GAME_ORIGIN}/`,
      allowedOrigins: [GAME_ORIGIN],
      limits: { minBet: 0.5, maxBet: 50, maxWin: 2500 },
      fairMode: 'client',
      ...overrides,
    },
    session: { token: TOKEN, expiresAt: '2030-01-01T00:00:00.000Z' },
    player: {
      id: 'u1',
      username: 'player',
      displayName: 'Игрок',
      role: 'player',
      isBot: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    wallet: { balance: '250.00', currency: 'CBK' },
    apiUrl: 'https://api.test',
  }
}

type Listener = (event: MessageEventLike) => void

type Wire = {
  /** Окно портала: игра вызывает у него postMessage, чтобы что-то сказать порталу. */
  portalWindow: { postMessage: (message: unknown, targetOrigin: string) => void }
  /** Окно iframe: портал вызывает у него postMessage, чтобы что-то сказать игре. */
  gameWindow: {
    postMessage: (message: unknown, targetOrigin: string) => void
    addEventListener: (type: 'message', listener: Listener) => void
    removeEventListener: (type: 'message', listener: Listener) => void
  }
  listenFromGame: (handler: Listener) => () => void
  isFromGame: (event: MessageEventLike) => boolean
  /** Все origin'ы, на которые портал адресовал сообщения. */
  portalTargetOrigins: string[]
  /** Все origin'ы, на которые адресовала сообщения игра. */
  gameTargetOrigins: string[]
  /** Подменить origin, с которого «приходит» игра. */
  setGameOrigin: (origin: string) => void
  /** Доставить в портал сообщение от произвольного окна. */
  deliverToPortal: (data: unknown, options: { origin: string; source: unknown }) => void
  /** Посчитать, сколько сообщений портал отправил игре. */
  countPortalMessages: () => number
}

function createWire(): Wire {
  const portalListeners = new Set<Listener>()
  const gameListeners = new Set<Listener>()

  const portalTargetOrigins: string[] = []
  const gameTargetOrigins: string[] = []

  let gameOrigin = GAME_ORIGIN

  // Браузерная семантика: postMessage вызывается У ОКНА-ПОЛУЧАТЕЛЯ, поэтому
  // портал пишет в окно iframe (его сообщения получает игра), а игра — в окно
  // родителя (его сообщения получает портал). Перепутать эти две стороны —
  // значит протестировать не то, что работает в браузере.

  const gameWindow = {
    postMessage(message: unknown, targetOrigin: string) {
      // Портал → игра. Доставка только при точном совпадении origin игры.
      portalTargetOrigins.push(targetOrigin)
      if (targetOrigin !== gameOrigin) return

      for (const listener of [...gameListeners]) {
        listener({ data: message, origin: PORTAL_ORIGIN, source: portalWindow })
      }
    },
    addEventListener(_type: 'message', listener: Listener) {
      gameListeners.add(listener)
    },
    removeEventListener(_type: 'message', listener: Listener) {
      gameListeners.delete(listener)
    },
  }

  const portalWindow = {
    postMessage(message: unknown, targetOrigin: string) {
      // Игра → портал. Доставка только при точном совпадении origin портала.
      gameTargetOrigins.push(targetOrigin)
      if (targetOrigin !== PORTAL_ORIGIN) return

      for (const listener of [...portalListeners]) {
        listener({ data: message, origin: gameOrigin, source: gameWindow })
      }
    },
  }

  return {
    portalWindow,
    gameWindow,
    portalTargetOrigins,
    gameTargetOrigins,
    listenFromGame: (handler) => {
      portalListeners.add(handler)
      return () => portalListeners.delete(handler)
    },
    isFromGame: (event) => event.source === gameWindow,
    setGameOrigin: (origin) => {
      gameOrigin = origin
    },
    deliverToPortal: (data, options) => {
      for (const listener of [...portalListeners]) {
        listener({ data, origin: options.origin, source: options.source })
      }
    },
    countPortalMessages: () => portalTargetOrigins.length,
  }
}

function sendHelloFromGame(wire: Wire, overrides: Record<string, unknown> = {}): void {
  // Игра обращается к окну родителя — его сообщения получает портал.
  wire.portalWindow.postMessage(
    {
      type: 'casino:hello',
      protocol: EMBED_PROTOCOL_VERSION,
      nonce: NONCE,
      gameSlug: SLUG,
      sdkVersion: '1.0.0',
      capabilities: ['wallet'],
      ...overrides,
    },
    PORTAL_ORIGIN,
  )
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function race<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout' | 'rejected'> {
  // Отказ тоже считается исходом: иначе он всплывёт как необработанный уже
  // в следующем тесте и упадёт не там, где сломалось.
  return Promise.race([
    promise.catch(() => 'rejected' as const),
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms)),
  ])
}

function startFixture(
  options: {
    launch?: GameLaunch
    withGame?: boolean
    fetchImpl?: (...args: never[]) => Promise<Response>
  } = {},
) {
  const wire = createWire()
  const launch = options.launch ?? createLaunch()
  const balances: string[] = []
  const gameErrors: Error[] = []

  const bridge = createEmbedBridge({
    launch,
    portalOrigin: PORTAL_ORIGIN,
    postToGame: (message, targetOrigin) => wire.gameWindow.postMessage(message, targetOrigin),
    listen: wire.listenFromGame,
    isFromGame: wire.isFromGame,
    setTimeoutFn: (handler, ms) => setTimeout(handler, ms),
    clearTimeoutFn: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    randomId: () => NONCE,
    retryMs: 10,
    initTimeoutMs: 120,
    onState: () => {},
  })

  const transport =
    options.withGame === false
      ? null
      : createPostMessageTransport({
          self: wire.gameWindow,
          parent: wire.portalWindow,
          fetchFn:
            (options.fetchImpl as never) ??
            (async () =>
              new Response(JSON.stringify({ balance: '240.00', entry: {}, idempotent: false }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              })),
          setTimeoutFn: (handler, ms) => setTimeout(handler, ms),
          clearTimeoutFn: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
          sdkVersion: '1.0.0',
          capabilities: ['wallet'],
          initTimeoutMs: 120,
        })

  const handlers = {
    onBalance: (balance: string) => balances.push(balance),
    onError: (error: Error) => gameErrors.push(error),
  }

  return { wire, bridge, transport, launch, balances, gameErrors, handlers }
}

describe('полный хендшейк портал ↔ SDK', () => {
  test('игра получает сессию, портал переходит в готовность', async () => {
    const fixture = startFixture()

    const session = await fixture.transport?.ready(fixture.handlers)

    expect(session?.balance).toBe('250.00')
    expect(session?.player?.displayName).toBe('Игрок')
    expect(session?.limits).toEqual({ minBet: 0.5, maxBet: 50, maxWin: 2500 })
    expect(fixture.bridge.state.status).toBe('ready')

    if (fixture.bridge.state.status === 'ready') {
      expect(fixture.bridge.state.sdkVersion).toBe('1.0.0')
    }

    fixture.bridge.destroy()
    fixture.transport?.dispose()
  })

  test('портал адресует сообщения только на объявленный origin игры', async () => {
    const fixture = startFixture()
    await fixture.transport?.ready(fixture.handlers)

    expect(fixture.wire.portalTargetOrigins.length).toBeGreaterThan(0)
    expect(new Set(fixture.wire.portalTargetOrigins)).toEqual(new Set([GAME_ORIGIN]))
    expect(fixture.wire.portalTargetOrigins).not.toContain('*')

    fixture.bridge.destroy()
    fixture.transport?.dispose()
  })

  test('игра адресует сообщения только на origin портала', async () => {
    const fixture = startFixture()
    await fixture.transport?.ready(fixture.handlers)

    expect(new Set(fixture.wire.gameTargetOrigins)).toEqual(new Set([PORTAL_ORIGIN]))
    expect(fixture.wire.gameTargetOrigins).not.toContain('*')

    fixture.bridge.destroy()
    fixture.transport?.dispose()
  })

  test('игра ходит в API с игровым токеном', async () => {
    const calls: Array<{ url: string; authorization: string | undefined }> = []

    const fixture = startFixture({
      fetchImpl: (async (url: string, init: RequestInit) => {
        const headers = init.headers as Record<string, string>
        calls.push({ url, authorization: headers.authorization })

        return new Response(
          JSON.stringify({
            balance: '240.00',
            entry: { amount: '-10.00', roundId: 'r-1' },
            idempotent: false,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }) as never,
    })

    await fixture.transport?.ready(fixture.handlers)
    const result = await fixture.transport?.bet({ amount: 10, roundId: 'r-1' })

    expect(calls[0]?.url).toBe('https://api.test/v1/game/bet')
    expect(calls[0]?.authorization).toBe(`Bearer ${TOKEN}`)
    expect(result?.balance).toBe('240.00')

    fixture.bridge.destroy()
    fixture.transport?.dispose()
  })

  test('портал передаёт в игру обновление баланса', async () => {
    const fixture = startFixture()
    await fixture.transport?.ready(fixture.handlers)

    fixture.bridge.pushBalance('150.00')
    expect(fixture.balances).toEqual(['150.00'])

    fixture.bridge.destroy()
    fixture.transport?.dispose()
  })

  test('после готовности портал перестаёт повторять приветствие', async () => {
    const fixture = startFixture()
    await fixture.transport?.ready(fixture.handlers)

    const before = fixture.wire.countPortalMessages()
    await wait(60)

    expect(fixture.wire.countPortalMessages()).toBe(before)

    fixture.bridge.destroy()
    fixture.transport?.dispose()
  })
})

describe('отказы в хендшейке', () => {
  /** Игра без SDK: портал не получает hello вовсе. */
  test('молчащая игра: портал сообщает о таймауте', async () => {
    const fixture = startFixture({ withGame: false })

    await wait(200)

    expect(fixture.bridge.state.status).toBe('error')
    if (fixture.bridge.state.status === 'error') {
      expect(fixture.bridge.state.code).toBe('handshake_timeout')
    }

    fixture.bridge.destroy()
  })

  /**
   * Так выглядит iframe, который уехал на другой домен: приветствие портала до него
   * не дошло (origin не совпал), зато он сам пытается говорить с порталом.
   */
  test('игра, оказавшаяся на чужом origin, сессии не получает', async () => {
    const fixture = startFixture({ withGame: false })

    fixture.wire.deliverToPortal(
      {
        type: 'casino:hello',
        protocol: EMBED_PROTOCOL_VERSION,
        nonce: NONCE,
        gameSlug: SLUG,
        sdkVersion: '1.0.0',
        capabilities: [],
      },
      { origin: EVIL_ORIGIN, source: fixture.wire.gameWindow },
    )

    await wait(20)

    expect(fixture.bridge.state.status).toBe('error')
    if (fixture.bridge.state.status === 'error') {
      expect(fixture.bridge.state.code).toBe('origin_not_allowed')
    }

    // Портал вправе писать только на объявленный origin — и только туда и писал.
    expect(new Set(fixture.wire.portalTargetOrigins)).toEqual(new Set([GAME_ORIGIN]))

    fixture.bridge.destroy()
  })

  test('портал не пишет игре, чей origin не совпадает с объявленным', async () => {
    const fixture = startFixture()

    // Игра живёт не там, где обещала: сообщения портала до неё не долетают.
    fixture.wire.setGameOrigin(EVIL_ORIGIN)

    const ready = (fixture.transport?.ready(fixture.handlers) ?? Promise.resolve()).catch(
      () => 'rejected' as const,
    )

    expect(await race(ready, 250)).toBe('rejected')
    expect(fixture.bridge.state.status).toBe('error')

    fixture.bridge.destroy()
    fixture.transport?.dispose()
  })

  test('hello с чужим nonce не даёт сессию', async () => {
    const fixture = startFixture({ withGame: false })

    sendHelloFromGame(fixture.wire, { nonce: 'чужой-nonce' })
    await wait(30)

    expect(fixture.bridge.state.status).toBe('connecting')

    fixture.bridge.destroy()
  })

  test('hello с чужим слагом не даёт сессию', async () => {
    const fixture = startFixture({ withGame: false })

    sendHelloFromGame(fixture.wire, { gameSlug: 'другая-игра' })
    await wait(30)

    expect(fixture.bridge.state.status).toBe('connecting')

    fixture.bridge.destroy()
  })

  test('hello от постороннего окна игнорируется', async () => {
    const fixture = startFixture({ withGame: false })

    // Верный origin, верный nonce, но source — не наш iframe.
    fixture.wire.deliverToPortal(
      {
        type: 'casino:hello',
        protocol: EMBED_PROTOCOL_VERSION,
        nonce: NONCE,
        gameSlug: SLUG,
        sdkVersion: '1.0.0',
        capabilities: [],
      },
      { origin: GAME_ORIGIN, source: { postMessage() {} } },
    )

    await wait(30)
    expect(fixture.bridge.state.status).toBe('connecting')

    fixture.bridge.destroy()
  })

  test('сообщение чужой версии протокола игнорируется', async () => {
    const fixture = startFixture({ withGame: false })

    sendHelloFromGame(fixture.wire, { protocol: EMBED_PROTOCOL_VERSION + 1 })
    await wait(30)

    expect(fixture.bridge.state.status).toBe('connecting')

    fixture.bridge.destroy()
  })

  test('корректный hello от нашего iframe приводит к готовности', async () => {
    const fixture = startFixture({ withGame: false })

    sendHelloFromGame(fixture.wire)
    await wait(30)

    expect(fixture.bridge.state.status).toBe('ready')

    fixture.bridge.destroy()
  })
})

describe('молчание до загрузки фрейма', () => {
  /**
   * Регрессия на шум в консоли: до события `load` во фрейме ещё `about:blank`,
   * и `postMessage` с чужим targetOrigin выбрасывает предупреждение, которое
   * выглядит как ошибка. Портал должен здороваться только после загрузки.
   */
  test('с autoStart: false приветствие не отправляется, пока не позовут', async () => {
    const wire = createWire()

    const bridge = createEmbedBridge({
      launch: createLaunch(),
      portalOrigin: PORTAL_ORIGIN,
      postToGame: (message, targetOrigin) => wire.gameWindow.postMessage(message, targetOrigin),
      listen: wire.listenFromGame,
      isFromGame: wire.isFromGame,
      setTimeoutFn: (handler, ms) => setTimeout(handler, ms),
      clearTimeoutFn: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      randomId: () => NONCE,
      retryMs: 10,
      initTimeoutMs: 120,
      autoStart: false,
      onState: () => {},
    })

    await wait(60)
    expect(wire.countPortalMessages()).toBe(0)

    // Событие load: портал здоровается и хендшейк идёт как обычно.
    bridge.ping()
    expect(wire.countPortalMessages()).toBeGreaterThan(0)

    sendHelloFromGame(wire)
    await wait(20)
    expect(bridge.state.status).toBe('ready')

    bridge.destroy()
  })
})
