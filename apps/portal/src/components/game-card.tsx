import { formatAmount } from '@luciferus/config/currency'
import {
  GAME_CATEGORY_LABELS,
  GAME_VOLATILITY_LABELS,
  type GameCard,
} from '@luciferus/protocol/game'
import Link from 'next/link'
import type { ReactNode } from 'react'

function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'gold' }) {
  const styles =
    tone === 'gold'
      ? 'border-gold-500/30 bg-gold-500/10 text-gold-300'
      : 'border-white/10 bg-white/5 text-white/60'

  return <span className={`rounded-full border px-2 py-0.5 text-[11px] ${styles}`}>{children}</span>
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-[11px] text-white/40">
      {label} <b className="text-white/65">{value}</b>
    </span>
  )
}

export function GameCardTile({ game }: { game: GameCard }) {
  const initial = game.title.slice(0, 1).toUpperCase()
  const rtpPercent = game.rtp ? `${(Number.parseFloat(game.rtp) * 100).toFixed(2)}%` : null
  const biggestWin = Number.parseFloat(game.stats.biggestWin ?? '0')

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
          {game.providerSlug ? (
            <Link
              href={`/providers/${game.providerSlug}`}
              className="text-xs text-white/45 hover:text-gold-300"
            >
              {game.providerName}
              {game.providerVerified ? ' · проверен' : ''}
            </Link>
          ) : (
            <p className="text-xs text-white/45">Без студии</p>
          )}
        </div>

        <p className="line-clamp-2 text-sm text-white/60">{game.description}</p>

        <div className="flex flex-wrap gap-1.5">
          {game.categories.map((category) => (
            <Badge key={category}>
              {GAME_CATEGORY_LABELS[category as keyof typeof GAME_CATEGORY_LABELS] ?? category}
            </Badge>
          ))}
          {rtpPercent && <Badge tone="gold">RTP {rtpPercent}</Badge>}
          {game.volatility && (
            <Badge>
              {GAME_VOLATILITY_LABELS[game.volatility as keyof typeof GAME_VOLATILITY_LABELS] ??
                game.volatility}
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Stat label="ставок:" value={String(game.stats.plays)} />
          <Stat label="мин. ставка:" value={formatAmount(game.limits.minBet)} />
          {biggestWin > 0 && <Stat label="макс. выигрыш:" value={formatAmount(biggestWin)} />}
        </div>

        {game.launchable ? (
          <Link
            href={`/game/${game.slug}`}
            className="mt-auto w-full rounded-xl border border-gold-500/40 bg-gold-500/15 px-3 py-2 text-center text-sm font-semibold text-gold-300 transition-colors hover:bg-gold-500/25"
          >
            Играть
          </Link>
        ) : (
          <span
            title="Игра не объявила свой origin — портал не сможет её запустить"
            className="mt-auto w-full cursor-not-allowed rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-center text-sm font-medium text-white/35"
          >
            Не подключена
          </span>
        )}
      </div>
    </article>
  )
}
