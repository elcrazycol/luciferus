import { formatAmount } from '@luciferus/config/currency'
import { GAME_CATEGORY_LABELS, type GameCard } from '@luciferus/protocol/game'
import Link from 'next/link'

/**
 * Карточка игры.
 *
 * Минимум текста: название, студия, одна строка фактов и действие. Всё
 * остальное — на странице игры. Карточка в каталоге нужна, чтобы выбрать, а не
 * чтобы изучить.
 */
export function GameCardTile({ game }: { game: GameCard }) {
  const initial = game.title.slice(0, 1).toUpperCase()
  const rtp = game.rtp ? `${(Number.parseFloat(game.rtp) * 100).toFixed(1)}%` : null
  const biggestWin = Number.parseFloat(game.stats.biggestWin ?? '0')

  const category = game.categories[0]
    ? (GAME_CATEGORY_LABELS[game.categories[0] as keyof typeof GAME_CATEGORY_LABELS] ??
      game.categories[0])
    : null

  const facts = [
    category,
    rtp ? `RTP ${rtp}` : null,
    game.stats.plays > 0 ? `${game.stats.plays} ставок` : null,
  ].filter(Boolean)

  return (
    <article className="glass glass-hover flex flex-col overflow-hidden">
      <div className="relative flex h-32 items-center justify-center bg-white/[0.02]">
        <span className="text-gold-gradient text-5xl font-black">{initial}</span>

        {game.fairMode === 'provably-fair' && (
          <span
            title="Исход каждого раунда можно проверить"
            className="absolute top-3 right-3 rounded-full bg-black/30 px-2 py-0.5 text-[10px] text-mint-500 backdrop-blur-sm"
          >
            проверяемый
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-white">{game.title}</h3>
          {game.providerSlug ? (
            <Link
              href={`/providers/${game.providerSlug}`}
              className="text-xs text-white/40 transition-colors hover:text-gold-300"
            >
              {game.providerName}
            </Link>
          ) : (
            <span className="text-xs text-white/40">без студии</span>
          )}
        </div>

        {facts.length > 0 && <p className="text-[11px] text-white/35">{facts.join(' · ')}</p>}

        {biggestWin > 0 && (
          <p className="text-[11px] text-white/35">
            макс. выигрыш <span className="text-gold-300">{formatAmount(biggestWin)}</span>
          </p>
        )}

        {game.launchable ? (
          <Link
            href={`/game/${game.slug}`}
            className="mt-auto rounded-xl border border-white/12 bg-white/6 py-2 text-center text-sm text-white/85 transition-colors hover:bg-white/12"
          >
            Играть
          </Link>
        ) : (
          <span
            title="Игра не объявила свой origin — портал не сможет её запустить"
            className="mt-auto cursor-not-allowed rounded-xl border border-white/6 py-2 text-center text-sm text-white/25"
          >
            Не подключена
          </span>
        )}
      </div>
    </article>
  )
}
