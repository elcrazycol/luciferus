import { GAME_STATUS_LABELS, GAME_STATUSES, type GameStatus } from '@luciferus/protocol/game'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ModerationCard } from '@/components/moderation-card'
import { ApiRequestError, getAdminOverview, getMe, getModerationQueue } from '@/lib/api'
import { getSessionToken } from '@/lib/session'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Модерация — LuciferusCasinos',
}

function StatusTabs({
  current,
  counts,
}: {
  current: GameStatus
  counts: Record<GameStatus, number>
}) {
  return (
    <nav className="flex flex-wrap gap-2">
      {GAME_STATUSES.map((status) => (
        <Link
          key={status}
          href={`/admin?status=${status}`}
          className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
            status === current
              ? 'border-gold-500/40 bg-gold-500/15 text-gold-300'
              : 'border-white/10 bg-white/5 text-white/55 hover:text-white'
          }`}
        >
          {GAME_STATUS_LABELS[status]}
          <span className="ml-2 text-xs opacity-70">{counts[status]}</span>
        </Link>
      ))}
    </nav>
  )
}

function GamePreview({
  game,
}: {
  game: Awaited<ReturnType<typeof getModerationQueue>>['games'][number]
}) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">{game.title}</h2>
          <p className="mt-1 font-mono text-xs text-white/40">{game.slug}</p>
        </div>

        <div className="text-right text-xs text-white/45">
          <p>
            автор:{' '}
            {game.authorUsername ? (
              <span className="text-white/70">{game.authorDisplayName ?? game.authorUsername}</span>
            ) : (
              <span className="text-white/40">из сидов</span>
            )}
          </p>
          <p className="mt-1">обновлена {new Date(game.updatedAt).toLocaleString('ru-RU')}</p>
        </div>
      </div>

      {game.description && <p className="mt-3 text-sm text-white/60">{game.description}</p>}

      <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-white/5 pt-4 text-xs sm:grid-cols-3">
        <div className="sm:col-span-2">
          <dt className="text-white/40">Адрес игры</dt>
          <dd className="mt-0.5 truncate font-mono text-white/70">{game.embedUrl}</dd>
        </div>
        <div>
          <dt className="text-white/40">Объявленные origin`ы</dt>
          <dd className="mt-0.5 font-mono text-white/70">
            {game.allowedOrigins.length > 0 ? game.allowedOrigins.join(', ') : 'нет'}
          </dd>
        </div>
      </dl>

      <p
        className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
          game.launchable
            ? 'border-mint-500/25 bg-mint-500/5 text-mint-500'
            : 'border-ember-500/25 bg-ember-500/5 text-ember-500'
        }`}
      >
        {game.launchable
          ? 'Origin объявлен — портал сможет поздороваться с игрой.'
          : 'Origin не объявлен: игру нельзя запустить. Автору нужно указать его в заявке.'}
      </p>
    </>
  )
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const token = await getSessionToken()
  if (!token) redirect(`/login?next=${encodeURIComponent('/admin')}`)

  let me: Awaited<ReturnType<typeof getMe>>
  try {
    me = await getMe(token)
  } catch (error) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
        <div className="rounded-2xl border border-ember-500/25 bg-ember-500/5 p-6">
          <h1 className="text-lg font-semibold text-white">API недоступен</h1>
          <p className="mt-1 text-sm text-white/60">
            {error instanceof ApiRequestError ? error.message : 'Не удалось проверить права'}
          </p>
        </div>
      </main>
    )
  }

  if (me.user.role !== 'admin') {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
        <div className="rounded-2xl border border-ember-500/25 bg-ember-500/5 p-6">
          <h1 className="text-lg font-semibold text-white">Нужны права администратора</h1>
          <p className="mt-1 text-sm text-white/60">
            Аккаунт {me.user.displayName} не имеет доступа к модерации. В демо-сборке админ —{' '}
            <code className="text-gold-300">admin / admin</code>.
          </p>
          <Link href="/" className="mt-4 inline-block text-sm text-gold-300 hover:underline">
            ← В лобби
          </Link>
        </div>
      </main>
    )
  }

  const { status: rawStatus } = await searchParams
  const status = GAME_STATUSES.find((value) => value === rawStatus) ?? 'pending'

  const [overview, queue] = await Promise.all([
    getAdminOverview(token),
    getModerationQueue(token, status),
  ])

  const counts: Record<GameStatus, number> = {
    pending: overview.games.pending,
    live: overview.games.live,
    disabled: overview.games.disabled,
    draft: overview.games.drafts,
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Модерация игр</h1>
          <p className="mt-1 text-sm text-white/50">
            Заявка попадает сюда после отправки. Пока игра не одобрена, её нет в каталоге.
          </p>
        </div>
      </div>

      <div className="mt-6">
        <StatusTabs current={status} counts={counts} />
      </div>

      {queue.games.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-white/10 bg-ink-900/60 p-6 text-sm text-white/55">
          Пусто. В статусе «{GAME_STATUS_LABELS[status].toLowerCase()}» игр нет.
        </p>
      ) : (
        <ul className="mt-8 space-y-5">
          {queue.games.map((game) => (
            <li key={game.slug}>
              <ModerationCard slug={game.slug} title={game.title}>
                <GamePreview game={game} />
              </ModerationCard>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-10 text-xs leading-6 text-white/35">
        Комментарий модератора видит только автор игры на странице «Мои игры». Игрокам он не
        показывается.
      </p>
    </main>
  )
}
