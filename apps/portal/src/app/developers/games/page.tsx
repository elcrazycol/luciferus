import { formatAmount } from '@luciferus/config/currency'
import { GAME_STATUS_LABELS, type GameStatus } from '@luciferus/protocol/game'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ApiRequestError, getMyGames } from '@/lib/api'
import { getSessionToken } from '@/lib/session'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Мои игры — LuciferusCasinos',
}

const STATUS_STYLES: Record<GameStatus, string> = {
  draft: 'border-white/15 bg-white/5 text-white/60',
  pending: 'border-gold-500/35 bg-gold-500/10 text-gold-300',
  live: 'border-mint-500/35 bg-mint-500/10 text-mint-500',
  disabled: 'border-ember-500/35 bg-ember-500/10 text-ember-500',
}

function StatusBadge({ status }: { status: GameStatus }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] tracking-wide uppercase ${STATUS_STYLES[status]}`}
    >
      {GAME_STATUS_LABELS[status]}
    </span>
  )
}

export default async function MyGamesPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>
}) {
  const token = await getSessionToken()
  if (!token) redirect(`/login?next=${encodeURIComponent('/developers/games')}`)

  let games: Awaited<ReturnType<typeof getMyGames>>['games']

  try {
    games = (await getMyGames(token)).games
  } catch (error) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
        <div className="rounded-2xl border border-ember-500/25 bg-ember-500/5 p-6">
          <h1 className="text-lg font-semibold text-white">Не удалось загрузить список</h1>
          <p className="mt-1 text-sm text-white/60">
            {error instanceof ApiRequestError ? error.message : 'API не ответил'}
          </p>
        </div>
      </main>
    )
  }

  const { submitted } = await searchParams

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <Link href="/developers" className="text-xs text-white/40 hover:text-gold-300">
        ← Разработчикам
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">Мои игры</h1>
        <Link
          href="/developers/submit"
          className="rounded-lg border border-gold-500/40 bg-gold-500/15 px-4 py-2 text-sm font-semibold text-gold-300 hover:bg-gold-500/25"
        >
          Добавить игру
        </Link>
      </div>

      {submitted && (
        <div className="mt-6 rounded-xl border border-mint-500/30 bg-mint-500/10 px-4 py-3 text-sm text-mint-500">
          Заявка на «{submitted}» отправлена. Статус можно смотреть здесь.
        </div>
      )}

      {games.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-white/10 bg-ink-900/60 p-6 text-sm text-white/55">
          <p className="text-white/75">Пока ни одной игры.</p>
          <p className="mt-2">
            Подключите SDK к своей игре и отправьте заявку —{' '}
            <Link href="/developers" className="text-gold-300 hover:underline">
              как это сделать
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="mt-8 space-y-4">
          {games.map((game) => (
            <li key={game.slug} className="card-gold rounded-2xl bg-ink-900/60 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-3 text-base font-semibold text-white">
                    {game.title}
                    <StatusBadge status={game.status} />
                  </h2>
                  <p className="mt-1 font-mono text-xs text-white/40">{game.slug}</p>
                </div>

                <div className="flex flex-wrap gap-3 text-sm">
                  {game.status === 'live' && game.launchable && (
                    <Link href={`/game/${game.slug}`} className="text-gold-300 hover:underline">
                      Открыть игру
                    </Link>
                  )}
                  {game.status !== 'live' && (
                    <Link
                      href={`/games?search=${game.slug}`}
                      className="text-white/45 hover:text-gold-300"
                    >
                      Смотреть в каталоге
                    </Link>
                  )}
                </div>
              </div>

              {game.moderationNote && (
                <p className="mt-4 rounded-xl border border-ember-500/25 bg-ember-500/5 px-4 py-3 text-sm text-white/70">
                  <span className="text-ember-500">Комментарий модератора: </span>
                  {game.moderationNote}
                </p>
              )}

              <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-white/5 pt-4 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-white/40">Ставок сделано</dt>
                  <dd className="text-white/75">{game.stats.plays}</dd>
                </div>
                <div>
                  <dt className="text-white/40">Мин. ставка</dt>
                  <dd className="text-white/75">{formatAmount(game.limits.minBet)}</dd>
                </div>
                <div>
                  <dt className="text-white/40">Origin`ов объявлено</dt>
                  <dd className="text-white/75">{game.allowedOrigins.length}</dd>
                </div>
                <div>
                  <dt className="text-white/40">Обновлена</dt>
                  <dd className="text-white/75">
                    {new Date(game.updatedAt).toLocaleDateString('ru-RU')}
                  </dd>
                </div>
              </dl>

              <p className="mt-4 text-[11px] leading-5 text-white/35">
                Правка описания или тегов не сбрасывает статус. Смена адреса игры, origin`ов или
                лимитов отправляет игру обратно на модерацию — нельзя незаметно подменить то, что
                уже проверили.
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
