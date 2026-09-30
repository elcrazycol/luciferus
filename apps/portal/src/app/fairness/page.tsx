import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  ClientSeedForm,
  CopyRoundButton,
  RotateSeedsForm,
  RoundVerifier,
} from '@/components/fairness-panel'
import { ApiRequestError, getFairRounds, getSeedPairs, listGames } from '@/lib/api'
import { getSessionToken } from '@/lib/session'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Честность игры — LuciferusCasinos',
  description: 'Раскрытые сиды и пересчёт раундов прямо в браузере.',
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] tracking-wider text-white/35 uppercase">{label}</p>
      <p className="mt-0.5 font-mono text-[11px] break-all text-white/70">{value}</p>
    </div>
  )
}

export default async function FairnessPage({
  searchParams,
}: {
  searchParams: Promise<{ game?: string; round?: string }>
}) {
  const token = await getSessionToken()
  if (!token) redirect(`/login?next=${encodeURIComponent('/fairness')}`)

  let games: Awaited<ReturnType<typeof listGames>>['games']

  try {
    games = (await listGames({ fairMode: 'provably-fair', limit: 48 })).games
  } catch (error) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
        <div className="glass p-6">
          <h1 className="text-lg font-semibold text-white">Не удалось загрузить игры</h1>
          <p className="mt-1 text-sm text-white/55">
            {error instanceof ApiRequestError ? error.message : 'API не ответил'}
          </p>
        </div>
      </main>
    )
  }

  if (games.length === 0) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
        <h1 className="text-2xl font-semibold text-white">Честность</h1>
        <p className="mt-3 text-sm leading-6 text-white/55">
          Пока ни одна игра не объявлена как проверяемая. В этом режиме портал публикует хэш
          скрытого сида до игры и показывает сам сид после раскрытия — тогда любой может пересчитать
          каждый раунд.
        </p>
        <Link href="/games" className="mt-5 inline-block text-sm text-gold-300 hover:underline">
          Посмотреть каталог →
        </Link>
      </main>
    )
  }

  const params = await searchParams
  const game = games.find((candidate) => candidate.slug === params.game) ?? games[0]
  if (!game) redirect('/games')

  const [seeds, rounds] = await Promise.all([
    getSeedPairs(token, game.slug),
    getFairRounds(token, game.slug),
  ])

  const requestedRound = params.round
    ? (rounds.rounds.find((round) => round.roundId === params.round) ?? null)
    : null

  const revealedPair = requestedRound?.serverSeedHash
    ? (seeds.revealed.find((pair) => pair.serverSeedHash === requestedRound.serverSeedHash) ?? null)
    : null

  const waiting = rounds.rounds.filter((round) => !round.verifiable).length
  const verifiable = rounds.rounds.length - waiting

  const prefill = requestedRound
    ? {
        serverSeed: revealedPair?.serverSeed ?? '',
        serverSeedHash: requestedRound.serverSeedHash ?? '',
        clientSeed: requestedRound.clientSeed ?? '',
        nonce: requestedRound.nonce ?? undefined,
        random: requestedRound.random ?? '',
      }
    : undefined

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold text-white">Честность</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">
        Портал публикует хэш серверного сида до игры и показывает сам сид после раскрытия. Между
        этими моментами исход подменить нельзя.
      </p>

      {games.length > 1 && (
        <div className="mt-5 flex flex-wrap gap-1.5">
          {games.map((candidate) => (
            <Link
              key={candidate.slug}
              href={`/fairness?game=${candidate.slug}`}
              className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                candidate.slug === game.slug
                  ? 'bg-white/10 text-white'
                  : 'text-white/45 hover:bg-white/5 hover:text-white'
              }`}
            >
              {candidate.title}
            </Link>
          ))}
        </div>
      )}

      {/* Главное на странице: состояние и одно действие. */}
      <section className="glass-raised mt-6 p-5">
        {rounds.rounds.length === 0 ? (
          <>
            <h2 className="text-base font-medium text-white">Раундов пока нет</h2>
            <p className="mt-1.5 text-sm text-white/50">
              Сыграйте в{' '}
              <Link href={`/game/${game.slug}`} className="text-gold-300 hover:underline">
                {game.title}
              </Link>{' '}
              — каждый раунд появится здесь вместе с данными для проверки.
            </p>
          </>
        ) : waiting > 0 ? (
          <>
            <h2 className="text-base font-medium text-white">
              {waiting} из {rounds.rounds.length} раундов ждут раскрытия сида
            </h2>
            <p className="mt-1.5 max-w-xl text-sm leading-6 text-white/50">
              Пока сид скрыт, проверить раунды нельзя — в этом и смысл: никто, включая портал, не
              мог знать исход заранее. Нажмите кнопку, чтобы раскрыть его. Это необратимо и
              безопасно: раскрывается <b className="text-white/70">прошлый</b> сид, а для новых
              раундов сразу создаётся новый.
            </p>

            <div className="mt-4 max-w-md">
              <RotateSeedsForm gameSlug={game.slug} roundsWaiting={waiting} />
            </div>
          </>
        ) : (
          <>
            <h2 className="text-base font-medium text-white">
              Все {verifiable} раундов проверяемы
            </h2>
            <p className="mt-1.5 text-sm text-white/50">
              Сид раскрыт — нажмите «Проверить» у любого раунда, и браузер пересчитает его сам.
            </p>
          </>
        )}
      </section>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="glass p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-white">Раунды</h2>
            <span className="text-xs text-white/35">
              {verifiable} проверяемо · {waiting} ждёт
            </span>
          </div>

          {rounds.rounds.length === 0 ? (
            <p className="mt-3 text-sm text-white/45">Пока пусто.</p>
          ) : (
            <ul className="mt-3 divide-y divide-white/5">
              {rounds.rounds.slice(0, 12).map((round) => (
                <li key={round.roundId} className="flex items-center gap-3 py-2.5">
                  <span className="w-10 shrink-0 font-mono text-xs text-white/40">
                    #{round.nonce ?? '—'}
                  </span>

                  <span className="min-w-0 flex-1 truncate text-xs text-white/50">
                    ставка {round.amount}
                    {round.payout ? ` · выигрыш ${round.payout}` : ''}
                  </span>

                  {round.verifiable ? (
                    <Link
                      href={`/fairness?game=${game.slug}&round=${round.roundId}`}
                      className="shrink-0 rounded-lg bg-white/8 px-2.5 py-1 text-xs text-gold-300 transition-colors hover:bg-white/12"
                    >
                      Проверить
                    </Link>
                  ) : (
                    <CopyRoundButton
                      payload={[
                        `nonce: ${round.nonce}`,
                        `random: ${round.random}`,
                        `clientSeed: ${round.clientSeed}`,
                        `serverSeedHash: ${round.serverSeedHash}`,
                      ].join('\n')}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}

          {rounds.rounds.length > 12 && (
            <p className="mt-3 text-[11px] text-white/30">
              Показаны последние 12 из {rounds.rounds.length}.
            </p>
          )}
        </section>

        <section className="glass p-5">
          <h2 className="text-sm font-medium text-white">Проверка</h2>

          {requestedRound && !revealedPair && (
            <p className="mt-2 text-xs leading-5 text-gold-300/80">
              Сид этой пары ещё скрыт — раскройте его кнопкой выше, и проверка станет возможной.
            </p>
          )}

          <div className="mt-3">
            <RoundVerifier prefill={prefill} />
          </div>
        </section>
      </div>

      <section className="glass mt-5 p-5">
        <h2 className="text-sm font-medium text-white">Текущая пара</h2>

        {seeds.active ? (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Хэш серверного сида" value={seeds.active.serverSeedHash} />
            <Field label="Клиентский сид" value={seeds.active.clientSeed} />
            <Field label="Выдано раундов" value={String(seeds.active.nonce)} />
          </div>
        ) : (
          <p className="mt-2 text-sm text-white/45">Появится при первой ставке в этой игре.</p>
        )}

        {seeds.active && (
          <div className="mt-4 border-t border-white/5 pt-4">
            <p className="text-xs text-white/40">
              Свой клиентский сид — сервер обязан использовать новый, и это будет видно при
              проверке.
            </p>
            <div className="mt-2 max-w-md">
              <ClientSeedForm gameSlug={game.slug} current={seeds.active.clientSeed} />
            </div>
          </div>
        )}
      </section>

      {seeds.revealed.length > 0 && (
        <section className="glass mt-5 p-5">
          <h2 className="text-sm font-medium text-white">Раскрытые пары</h2>
          <ul className="mt-3 divide-y divide-white/5">
            {seeds.revealed.slice(0, 5).map((pair) => (
              <li key={pair.id} className="grid grid-cols-1 gap-3 py-3 sm:grid-cols-3">
                <Field label="Серверный сид" value={pair.serverSeed ?? ''} />
                <Field label="Хэш" value={pair.serverSeedHash} />
                <Field
                  label="Раскрыта"
                  value={new Date(pair.revealedAt ?? pair.createdAt).toLocaleDateString('ru-RU')}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="glass mt-5 p-5">
        <summary className="cursor-pointer text-sm font-medium text-white">
          Как это работает
        </summary>

        <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs leading-6 text-white/45">
          <li>Портал создаёт серверный сид и сразу публикует его хэш. Сам сид скрыт.</li>
          <li>
            Клиентский сид виден вам, и вы можете его сменить — сервер обязан использовать новый.
          </li>
          <li>
            Случайность раунда:{' '}
            <span className="font-mono text-white/60">
              HMAC-SHA256(серверный сид, клиентский сид : номер)
            </span>
            . Номер растёт и не повторяется.
          </li>
          <li>
            Игра превращает это число в исход по своей таблице весов. Подсунуть своё число она не
            может: портал пересчитывает результат и отклоняет ставку при расхождении.
          </li>
          <li>Раскрыв сид, вы проверяете каждый раунд здесь, в браузере — без участия портала.</li>
        </ol>

        <p className="mt-4 text-xs leading-6 text-white/35">
          Чего схема не доказывает: что игра отобразила полученное число честно. За это отвечает
          автор игры, поэтому случайность раунда сохраняется в журнале и видна рядом с исходом.
        </p>
      </details>
    </main>
  )
}
