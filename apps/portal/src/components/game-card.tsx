import { currency } from '@luciferus/config/currency'
import type { ReactNode } from 'react'
import type { GameCard } from '@/lib/api'

export const CATEGORY_LABELS: Record<string, string> = {
  slots: 'Слоты',
  classic: 'Классика',
  crash: 'Краш',
  table: 'Столы',
  cards: 'Карты',
  multiplayer: 'Мультиплеер',
  live: 'Лайв',
}

const VOLATILITY_LABELS: Record<string, string> = {
  low: 'низкая волатильность',
  medium: 'средняя волатильность',
  high: 'высокая волатильность',
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/60">
      {children}
    </span>
  )
}

export function GameCardTile({ game }: { game: GameCard }) {
  const initial = game.title.slice(0, 1).toUpperCase()
  const rtpPercent = game.rtp ? `${(Number.parseFloat(game.rtp) * 100).toFixed(2)}% RTP` : null
  const volatility = game.volatility ? VOLATILITY_LABELS[game.volatility] : null

  return (
    <article className="card-gold flex flex-col overflow-hidden rounded-2xl bg-ink-900/70">
      <div className="relative flex h-40 items-center justify-center bg-gradient-to-br from-ink-800 via-ink-850 to-ink-900">
        <span className="text-gold-gradient text-6xl font-black">{initial}</span>

        <span className="absolute top-3 left-3 rounded-full border border-gold-500/30 bg-ink-950/70 px-2 py-0.5 text-[10px] tracking-wide text-gold-300 uppercase">
          {game.fairMode === 'provably-fair' ? 'проверяемый рандом' : 'доверенный рандом'}
        </span>

        {game.isStub && (
          <span className="absolute top-3 right-3 rounded-full border border-white/10 bg-ink-950/70 px-2 py-0.5 text-[10px] text-white/50">
            заглушка
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <h3 className="text-base font-semibold text-white">{game.title}</h3>
          <p className="text-xs text-white/45">
            {game.providerName ?? 'Без провайдера'}
            {game.providerVerified ? ' · проверен' : ''}
          </p>
        </div>

        <p className="line-clamp-2 text-sm text-white/60">{game.description}</p>

        <div className="flex flex-wrap gap-1.5">
          {game.categories.map((category) => (
            <Badge key={category}>{CATEGORY_LABELS[category] ?? category}</Badge>
          ))}
          {rtpPercent && <Badge>{rtpPercent}</Badge>}
          {volatility && <Badge>{volatility}</Badge>}
        </div>

        <div className="mt-auto flex items-center justify-between border-t border-white/5 pt-3 text-[11px] text-white/40">
          <span>
            ставка от {currency.symbol}
            {game.limits.minBet}
          </span>
          <span>
            макс. выигрыш {currency.symbol}
            {game.limits.maxWin}
          </span>
        </div>

        {/* Кнопка появится в фазе 3 вместе с launcher'ом и проверкой origin. */}
        <button
          type="button"
          disabled
          title="Игровой лаунчер появится в фазе 3"
          className="w-full cursor-not-allowed rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white/35"
        >
          Играть — скоро
        </button>
      </div>
    </article>
  )
}
