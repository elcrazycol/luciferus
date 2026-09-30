import { formatAmount } from '@luciferus/config/currency'
import { GAME_CATEGORY_LABELS, type GameCard } from '@luciferus/protocol/game'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { GameLauncher } from '@/components/game-launcher'
import { ApiRequestError, getGame, launchGame } from '@/lib/api'
import { getSessionToken } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params

  try {
    const { game } = await getGame(slug)
    return {
      title: `${game.title} — LuciferusCasinos`,
      description: game.description || `Игра ${game.title} на LuciferusCasinos`,
    }
  } catch {
    return { title: `Игра ${slug} — LuciferusCasinos` }
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/5 py-2 last:border-0">
      <dt className="text-xs text-white/40">{label}</dt>
      <dd className="text-right text-sm text-white/75">{value}</dd>
    </div>
  )
}

/** Боковая панель: всё, что полезно знать об игре, не отрываясь от неё. */
function GameSidebar({ game }: { game: GameCard }) {
  const biggestWin = Number.parseFloat(game.stats.biggestWin ?? '0')

  return (
    <aside className="space-y-4">
      <section className="glass rounded-2xl bg-ink-900/60 p-5">
        <h2 className="text-sm font-semibold text-white">Об игре</h2>

        {game.description && (
          <p className="mt-2 text-sm leading-6 text-white/60">{game.description}</p>
        )}

        <dl className="mt-3">
          <Row label="Студия" value={game.providerName ?? 'без студии'} />
          <Row
            label="Рандом"
            value={game.fairMode === 'provably-fair' ? 'проверяемый' : 'доверенный'}
          />
          <Row
            label="RTP"
            value={game.rtp ? `${(Number.parseFloat(game.rtp) * 100).toFixed(2)}%` : '—'}
          />
          <Row label="Волатильность" value={game.volatility ? game.volatility : '—'} />
          <Row label="Хостится на" value={new URL(game.embedUrl).origin} />
        </dl>

        {game.providerSlug && (
          <Link
            href={`/providers/${game.providerSlug}`}
            className="mt-3 inline-block text-xs text-gold-300 hover:underline"
          >
            Все игры студии →
          </Link>
        )}
      </section>

      <section className="glass rounded-2xl bg-ink-900/60 p-5">
        <h2 className="text-sm font-semibold text-white">Лимиты</h2>

        <dl className="mt-3">
          <Row label="Минимальная ставка" value={formatAmount(game.limits.minBet)} />
          <Row label="Максимальная ставка" value={formatAmount(game.limits.maxBet)} />
          <Row label="Максимальный выигрыш" value={formatAmount(game.limits.maxWin)} />
        </dl>

        <p className="mt-3 text-[11px] leading-5 text-white/35">
          Лимиты проверяет сервер. Игра может попросить больше — портал откажет.
        </p>
      </section>

      <section className="glass rounded-2xl bg-ink-900/60 p-5">
        <h2 className="text-sm font-semibold text-white">Статистика</h2>

        <dl className="mt-3">
          <Row label="Ставок сделано" value={String(game.stats.plays)} />
          {biggestWin > 0 && <Row label="Крупнейший выигрыш" value={formatAmount(biggestWin)} />}
          <Row
            label="Последняя игра"
            value={
              game.stats.lastPlayedAt
                ? new Date(game.stats.lastPlayedAt).toLocaleString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : 'ещё не играли'
            }
          />
        </dl>

        <p className="mt-3 text-[11px] leading-5 text-white/35">
          Считается по журналу операций, а не отдельным счётчиком — поэтому не может разойтись с
          историей кошелька.
        </p>
      </section>

      {game.tags.length > 0 && (
        <section className="glass rounded-2xl bg-ink-900/60 p-5">
          <h2 className="text-sm font-semibold text-white">Метки</h2>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {game.categories.map((category) => (
              <Link
                key={category}
                href={`/games?category=${category}`}
                className="rounded-full border border-gold-500/25 bg-gold-500/10 px-2.5 py-0.5 text-[11px] text-gold-300 hover:bg-gold-500/20"
              >
                {GAME_CATEGORY_LABELS[category as keyof typeof GAME_CATEGORY_LABELS] ?? category}
              </Link>
            ))}
            {game.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] text-white/55"
              >
                {tag}
              </span>
            ))}
          </div>
        </section>
      )}
    </aside>
  )
}

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const token = await getSessionToken()
  if (!token) {
    // Возвращаем игрока сюда же после входа.
    redirect(`/login?next=${encodeURIComponent(`/game/${slug}`)}`)
  }

  let launch: Awaited<ReturnType<typeof launchGame>>
  let card: GameCard | null = null

  try {
    launch = await launchGame(token, slug)
    // Карточка необязательна: если она не пришла, игру всё равно показываем.
    card = await getGame(slug)
      .then((response) => response.game)
      .catch(() => null)
  } catch (error) {
    const message =
      error instanceof ApiRequestError ? error.message : 'Не удалось подготовить запуск игры'

    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
        <div className="rounded-2xl border border-ember-500/25 bg-ember-500/5 p-6">
          <h1 className="text-lg font-semibold text-white">Игра не запустилась</h1>
          <p className="mt-1 text-sm text-white/60">{message}</p>

          <p className="mt-4 text-xs text-white/40">
            Частая причина: игра не объявила свой origin в манифесте — тогда порталу некуда
            адресовать приветствие. Демонстрационная игра{' '}
            <code className="text-gold-300">lucky-7s</code> объявлена и запускается.
          </p>

          <div className="mt-4 flex gap-4 text-sm">
            <Link href="/games" className="text-gold-300 hover:underline">
              В каталог
            </Link>
            <Link href="/developers" className="text-gold-300 hover:underline">
              Как подключить игру
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/games" className="text-xs text-white/40 hover:text-gold-300">
            ← Каталог
          </Link>
          <h1 className="mt-2 text-xl font-bold text-white">{launch.game.title}</h1>
        </div>

        <p className="text-xs text-white/40">
          ставки от {formatAmount(launch.game.limits.minBet)} до{' '}
          {formatAmount(launch.game.limits.maxBet)}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <GameLauncher launch={launch} />
        {card && <GameSidebar game={card} />}
      </div>

      <p className="mt-5 text-xs leading-6 text-white/35">
        Игра хостится на {new URL(launch.game.embedUrl).origin} и общается с порталом через
        postMessage. Баланс ведёт портал: каждая ставка и выплата попадают в журнал и видны в{' '}
        <Link href="/wallet" className="text-gold-300 hover:underline">
          кошельке
        </Link>
        .
      </p>
    </main>
  )
}
