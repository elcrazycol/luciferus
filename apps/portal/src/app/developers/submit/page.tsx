import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { SubmitGameForm } from '@/components/submit-game-form'
import { getSessionToken } from '@/lib/session'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Добавить игру — LuciferusCasinos',
}

export default async function SubmitGamePage() {
  const token = await getSessionToken()
  if (!token) redirect(`/login?next=${encodeURIComponent('/developers/submit')}`)

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <Link href="/developers" className="text-xs text-white/40 hover:text-gold-300">
        ← Разработчикам
      </Link>

      <h1 className="mt-4 text-2xl font-bold text-white">Добавить игру</h1>
      <p className="mt-2 text-sm leading-6 text-white/55">
        Игра остаётся на вашем хостинге — портал только откроет её и даст кошелёк игрока. Перед
        отправкой убедитесь, что игра подключает SDK и объявляет свой origin.
      </p>

      <div className="mt-6 rounded-xl border border-gold-500/25 bg-gold-500/5 p-4 text-xs leading-6 text-gold-300">
        Важно: origin должен совпадать с адресом игры. Если игра открыта на{' '}
        <code>https://game.example/play</code>, то объявлять нужно <code>https://game.example</code>{' '}
        — без пути. Портал проверит это до отправки.
      </div>

      <div className="mt-8">
        <SubmitGameForm />
      </div>
    </main>
  )
}
