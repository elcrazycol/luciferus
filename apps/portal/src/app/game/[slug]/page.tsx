import { formatAmount } from '@luciferus/config/currency'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { GameLauncher } from '@/components/game-launcher'
import { ApiRequestError, launchGame } from '@/lib/api'
import { getSessionToken } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  return { title: `Игра ${slug} — LuciferusCasinos` }
}

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const token = await getSessionToken()
  if (!token) {
    // Возвращаем игрока сюда же после входа.
    redirect(`/login?next=${encodeURIComponent(`/game/${slug}`)}`)
  }

  let launch: Awaited<ReturnType<typeof launchGame>>

  try {
    launch = await launchGame(token, slug)
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
            <Link href="/" className="text-gold-300 hover:underline">
              В лобби
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
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">{launch.game.title}</h1>
          <p className="text-xs text-white/45">
            {launch.game.slug} · ставки от {formatAmount(launch.game.limits.minBet)} до{' '}
            {formatAmount(launch.game.limits.maxBet)} ·{' '}
            {launch.game.fairMode === 'provably-fair' ? 'проверяемый рандом' : 'доверенный рандом'}
          </p>
        </div>

        <Link href="/" className="text-sm text-gold-300 hover:underline">
          ← В лобби
        </Link>
      </div>

      <GameLauncher launch={launch} />

      <p className="mt-4 text-xs leading-6 text-white/35">
        Игра хостится на {new URL(launch.game.embedUrl).origin} и общается с порталом через
        postMessage. Баланс ведёт портал: каждая ставка и выплата попадают в журнал и видны в
        кошельке.
      </p>
    </main>
  )
}
