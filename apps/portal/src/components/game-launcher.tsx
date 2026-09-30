'use client'

import { formatAmount } from '@luciferus/config/currency'
import type { GameLaunch } from '@luciferus/protocol/embed'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { createEmbedBridge, type EmbedBridge, type EmbedBridgeState } from '@/lib/embed-bridge'

const BALANCE_POLL_MS = 10_000

function StatusBar({
  state,
  balance,
  currency,
  gameSlug,
}: {
  state: EmbedBridgeState
  balance: string
  currency: string
  gameSlug: string
}) {
  const dot =
    state.status === 'ready'
      ? 'bg-mint-500'
      : state.status === 'error'
        ? 'bg-ember-500'
        : 'bg-gold-400 animate-pulse'

  const label =
    state.status === 'ready'
      ? `Игра подключена (SDK ${state.sdkVersion})`
      : state.status === 'error'
        ? 'Игра не подключилась'
        : 'Договариваемся с игрой…'

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-t-2xl border border-b-0 border-white/10 bg-ink-900/80 px-4 py-2.5 text-xs">
      <span className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <span className={state.status === 'error' ? 'text-ember-500' : 'text-white/60'}>
          {label}
        </span>
      </span>

      <span className="ml-auto flex items-center gap-3">
        <span className="text-white/35">{gameSlug}</span>
        <span className="font-semibold text-gold-300" title={currency}>
          {formatAmount(balance)}
        </span>
      </span>
    </div>
  )
}

function ErrorPanel({ state, slug }: { state: EmbedBridgeState; slug: string }) {
  if (state.status !== 'error') return null

  const hint =
    state.code === 'handshake_timeout'
      ? 'Игра должна подключить SDK: <script src="…/sdk/v1.js" async></script>'
      : null

  return (
    <div className="border border-t-0 border-ember-500/25 bg-ember-500/5 p-4 text-sm">
      <p className="font-medium text-ember-500">{state.message}</p>
      {hint && <p className="mt-1 font-mono text-xs text-white/45">{hint}</p>}

      <p className="mt-3 flex flex-wrap gap-4 text-xs">
        <Link href="/" className="text-gold-300 hover:underline">
          Вернуться в лобби
        </Link>
        <Link href="/developers" className="text-gold-300 hover:underline">
          Как подключить игру
        </Link>
        <span className="text-white/30">игра: {slug}</span>
      </p>
    </div>
  )
}

/**
 * Запускает игру в iframe и ведёт хендшейк.
 *
 * Портал — инициатор: он знает объявленный origin игры и адресует приветствие точно
 * ему. Игра не постит в `*` вообще, а сессию получает только после того, как портал
 * сверит origin, nonce и слаг.
 */
export function GameLauncher({ launch }: { launch: GameLaunch }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const bridgeRef = useRef<EmbedBridge | null>(null)

  const [state, setState] = useState<EmbedBridgeState>({ status: 'connecting' })
  const [balance, setBalance] = useState(launch.wallet.balance)

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    const bridge = createEmbedBridge({
      launch,
      portalOrigin: window.location.origin,
      postToGame: (message, targetOrigin) => {
        iframe.contentWindow?.postMessage(message, targetOrigin)
      },
      listen: (handler) => {
        window.addEventListener('message', handler)
        return () => window.removeEventListener('message', handler)
      },
      // Сообщение обязано прийти именно из нашего iframe, а не из соседней вкладки
      // или расширения браузера.
      isFromGame: (event) => event.source === iframe.contentWindow,
      setTimeoutFn: (handler, ms) => window.setTimeout(handler, ms),
      clearTimeoutFn: (id) => window.clearTimeout(id as number),
      randomId: () => crypto.randomUUID(),
      onState: setState,
    })

    bridgeRef.current = bridge

    return () => {
      bridge.destroy()
      bridgeRef.current = null
    }
  }, [launch])

  // Пока игрок в игре, портал подтягивает баланс и отдаёт его игре — чтобы счётчик
  // в интерфейсе игры совпадал с настоящим, а не с тем, что игра помнит у себя.
  useEffect(() => {
    if (state.status !== 'ready') return

    let cancelled = false

    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const response = await fetch('/api/wallet/balance', { cache: 'no-store' })
          if (!response.ok || cancelled) return

          const payload = (await response.json()) as { balance?: string }
          if (cancelled || typeof payload.balance !== 'string') return

          setBalance(payload.balance)
          bridgeRef.current?.pushBalance(payload.balance)
        } catch {
          // Недоступный портал не должен ломать игру, которая уже идёт.
        }
      })()
    }, BALANCE_POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [state.status])

  return (
    <div className="overflow-hidden rounded-2xl">
      <StatusBar
        state={state}
        balance={balance}
        currency={launch.wallet.currency}
        gameSlug={launch.game.slug}
      />

      <iframe
        ref={iframeRef}
        src={launch.game.embedUrl}
        title={launch.game.title}
        onLoad={() => bridgeRef.current?.ping()}
        // Игра не должна узнавать адрес портала через Referer: он ей не нужен,
        // origin приходит в casino:init.
        referrerPolicy="no-referrer"
        allow="fullscreen; clipboard-write"
        className="h-[640px] w-full border border-white/10 bg-ink-950"
      />

      <ErrorPanel state={state} slug={launch.game.slug} />
    </div>
  )
}
