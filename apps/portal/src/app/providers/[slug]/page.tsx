import type { Metadata } from 'next'
import Link from 'next/link'
import { GameCardTile } from '@/components/game-card'
import { ApiRequestError, getProvider, listGames } from '@/lib/api'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  return { title: `Студия ${slug} — LuciferusCasinos` }
}

export default async function ProviderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  let provider: Awaited<ReturnType<typeof getProvider>>['provider']
  let games: Awaited<ReturnType<typeof listGames>>['games']

  try {
    const [providerResponse, gamesResponse] = await Promise.all([
      getProvider(slug),
      listGames({ provider: slug, limit: 48 }),
    ])

    provider = providerResponse.provider
    games = gamesResponse.games
  } catch (error) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
        <div className="rounded-2xl border border-ember-500/25 bg-ember-500/5 p-6">
          <h1 className="text-lg font-semibold text-white">Студия не найдена</h1>
          <p className="mt-1 text-sm text-white/60">
            {error instanceof ApiRequestError ? error.message : 'API не ответил'}
          </p>
          <Link href="/games" className="mt-4 inline-block text-sm text-gold-300 hover:underline">
            ← В каталог
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/games" className="text-xs text-white/40 hover:text-gold-300">
        ← Каталог
      </Link>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold text-white">
            {provider.name}
            {provider.verified && (
              <span className="rounded-full border border-mint-500/40 bg-mint-500/10 px-2 py-0.5 text-[10px] tracking-wide text-mint-500 uppercase">
                проверена
              </span>
            )}
          </h1>

          <p className="mt-1 text-sm text-white/50">
            {provider.gamesCount}{' '}
            {provider.gamesCount === 1 ? 'игра' : provider.gamesCount < 5 ? 'игры' : 'игр'} · ставок
            сделано: {provider.playsTotal}
          </p>
        </div>

        {provider.url && (
          <a
            href={provider.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sm text-gold-300 hover:underline"
          >
            Сайт студии ↗
          </a>
        )}
      </header>

      {games.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-white/10 bg-ink-900/60 p-6 text-sm text-white/55">
          У этой студии пока нет опубликованных игр.
        </p>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {games.map((game) => (
            <GameCardTile key={game.slug} game={game} />
          ))}
        </div>
      )}

      <p className="mt-10 text-xs text-white/35">
        Студии создаются автоматически при первой публикации игры. Проверенные студии отмечает
        администрация площадки.
      </p>
    </main>
  )
}
