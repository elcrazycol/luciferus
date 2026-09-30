'use client'

import { formatAmount } from '@luciferus/config/currency'
import { useRouter } from 'next/navigation'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

/**
 * Живой баланс игрока.
 *
 * Поток событий приходит с сервера, поэтому цифра меняется сразу после ставки в
 * игре — не после перезагрузки. Заодно дёргаем `router.refresh()`: он обновляет
 * всё, что отрисовано на сервере (история операций, статистика игры, шапка).
 *
 * События приходят пачками (спин — это ставка и выплата почти одновременно),
 * поэтому обновление серверных данных откладывается на пару сотен миллисекунд.
 */

const REFRESH_DEBOUNCE_MS = 250

type LiveBalance = {
  /** Баланс из потока. `null`, пока не пришло ни одного события. */
  balance: string | null
  /** Последнее изменение: удобно показать всплывающую цифру. */
  delta: string | null
  reason: string | null
  connected: boolean
}

const LiveBalanceContext = createContext<LiveBalance>({
  balance: null,
  delta: null,
  reason: null,
  connected: false,
})

export function useLiveBalance(): LiveBalance {
  return useContext(LiveBalanceContext)
}

export function LiveBalanceProvider({
  children,
  enabled,
}: {
  children: ReactNode
  /** Гостям поток не нужен: сервер ответит 401, а EventSource будет переподключаться вечно. */
  enabled: boolean
}) {
  const router = useRouter()
  const [state, setState] = useState<LiveBalance>({
    balance: null,
    delta: null,
    reason: null,
    connected: false,
  })

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)

    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null
      router.refresh()
    }, REFRESH_DEBOUNCE_MS)
  }, [router])

  useEffect(() => {
    if (!enabled) return

    const source = new EventSource('/api/wallet/stream')

    source.addEventListener('open', () => {
      setState((current) => ({ ...current, connected: true }))
    })

    source.addEventListener('balance', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        balance?: string
        delta?: string
        reason?: string
      }

      if (typeof payload.balance !== 'string') return

      setState({
        balance: payload.balance,
        delta: payload.delta ?? null,
        reason: payload.reason ?? null,
        connected: true,
      })

      // Первое событие — это текущий баланс при подключении: перерисовывать нечего.
      if (payload.reason === 'initial') return

      scheduleRefresh()
    })

    source.addEventListener('error', () => {
      setState((current) => ({ ...current, connected: false }))
      // EventSource переподключается сам; закрывать его здесь нельзя.
    })

    return () => {
      source.close()
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    }
  }, [enabled, scheduleRefresh])

  const value = useMemo(() => state, [state])

  return <LiveBalanceContext.Provider value={value}>{children}</LiveBalanceContext.Provider>
}

/**
 * Баланс в шапке.
 *
 * Показываем значение из потока, а до первого события — то, что отрисовал сервер:
 * цифра не должна мигать пустотой при загрузке.
 */
export function BalanceChip({ initial }: { initial: string }) {
  const { balance, delta } = useLiveBalance()
  const current = balance ?? initial

  const [flash, setFlash] = useState(false)
  const previous = useRef(current)

  useEffect(() => {
    if (current === previous.current) return

    previous.current = current
    setFlash(true)

    const timer = setTimeout(() => setFlash(false), 600)
    return () => clearTimeout(timer)
  }, [current])

  return (
    <span
      title="Открыть кошелёк"
      className={`rounded-xl border px-3 py-1.5 text-sm font-semibold tabular-nums transition-colors duration-300 ${
        flash
          ? 'border-mint-500/50 bg-mint-500/15 text-mint-500'
          : 'border-white/10 bg-white/5 text-gold-300'
      }`}
    >
      {formatAmount(current)}
      {flash && delta && delta !== '0.00' && (
        <span className="ml-1.5 text-[11px] opacity-80">
          {delta.startsWith('-') ? '−' : '+'}
          {formatAmount(delta.replace('-', ''), { withSymbol: false })}
        </span>
      )}
    </span>
  )
}
