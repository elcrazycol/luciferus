import { GAME_STATUS_LABELS } from '@luciferus/protocol/game'
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
  description:
    'Проверка раундов: раскрытые серверные сиды, клиентские сиды и пересчёт случайности прямо в браузере.',
}

function Row({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border-b border-white/5 py-2.5 last:border-0">
      <p className="text-[11px] tracking-wider text-white/40 uppercase">{label}</p>
      <p className={`mt-0.5 text-sm break-all text-white/80 ${mono ? 'font-mono text-xs' : ''}`}>
        {value}
      </p>
    </div>
  )
}

function PairCard({
  title,
  hash,
  clientSeed,
  nonce,
  serverSeed,
  revealedAt,
  algorithm,
}: {
  title: string
  hash: string
  clientSeed: string
  nonce: number
  serverSeed?: string | null
  revealedAt?: string | null
  algorithm: string
}) {
  return (
    <div className="card-gold rounded-2xl bg-ink-900/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {revealedAt && (
          <span className="rounded-full border border-mint-500/30 bg-mint-500/10 px-2 py-0.5 text-[10px] tracking-wide text-mint-500 uppercase">
            раскрыта
          </span>
        )}
      </div>

      <div className="mt-2">
        <Row label="Хэш серверного сида (коммит)" value={hash} />
        <Row label="Клиентский сид" value={clientSeed} />
        <Row label="Выдано раундов" value={String(nonce)} mono={false} />
        <Row label="Алгоритм" value={algorithm} mono={false} />

        {serverSeed ? (
          <Row label="Серверный сид (раскрыт)" value={serverSeed} />
        ) : (
          <div className="py-2.5">
            <p className="text-[11px] tracking-wider text-white/40 uppercase">Серверный сид</p>
            <p className="mt-0.5 text-xs text-white/45">
              Скрыт до раскрытия — иначе играть было бы нечестно. Нажмите «Раскрыть», чтобы увидеть
              его и проверить сыгранные раунды.
            </p>
          </div>
        )}

        {revealedAt && (
          <p className="pt-2 text-[11px] text-white/30">
            Раскрыта {new Date(revealedAt).toLocaleString('ru-RU')}
          </p>
        )}
      </div>
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
        <div className="rounded-2xl border border-ember-500/25 bg-ember-500/5 p-6">
          <h1 className="text-lg font-semibold text-white">Не удалось загрузить игры</h1>
          <p className="mt-1 text-sm text-white/60">
            {error instanceof ApiRequestError ? error.message : 'API не ответил'}
          </p>
        </div>
      </main>
    )
  }

  if (games.length === 0) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-14 sm:px-6">
        <h1 className="text-2xl font-bold text-white">Проверяемая честность</h1>
        <p className="mt-3 text-sm leading-6 text-white/55">
          Пока ни одна игра не объявлена как проверяемая. В этом режиме портал публикует хэш
          скрытого сида до игры, а после раскрытия показывает сам сид — и любой может пересчитать
          каждый раунд.
        </p>
        <Link href="/games" className="mt-4 inline-block text-sm text-gold-300 hover:underline">
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

  // Раунд, который просят проверить: данные берём из журнала, а сид — из раскрытой пары.
  const requestedRound = params.round
    ? (rounds.rounds.find((round) => round.roundId === params.round) ?? null)
    : null

  const revealedPair = requestedRound?.serverSeedHash
    ? (seeds.revealed.find((pair) => pair.serverSeedHash === requestedRound.serverSeedHash) ?? null)
    : null

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
      <h1 className="text-2xl font-bold text-white">Проверяемая честность</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">
        Портал публикует хэш серверного сида <b className="text-white/75">до</b> игры и показывает
        сам сид после раскрытия. Между этими двумя моментами изменить исход невозможно: подобрать
        другой сид с тем же хэшем нельзя.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {games.map((candidate) => (
          <Link
            key={candidate.slug}
            href={`/fairness?game=${candidate.slug}`}
            className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              candidate.slug === game.slug
                ? 'border-gold-500/40 bg-gold-500/15 text-gold-300'
                : 'border-white/10 bg-white/5 text-white/55 hover:text-white'
            }`}
          >
            {candidate.title}
          </Link>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          {seeds.active ? (
            <PairCard
              title="Текущая пара сидов"
              hash={seeds.active.serverSeedHash}
              clientSeed={seeds.active.clientSeed}
              nonce={seeds.active.nonce}
              algorithm={seeds.active.algorithm}
            />
          ) : (
            <div className="card-gold rounded-2xl bg-ink-900/60 p-5 text-sm text-white/55">
              Активной пары ещё нет. Она появится при первой же ставке в этой игре.
            </div>
          )}

          <div className="card-gold rounded-2xl bg-ink-900/60 p-5">
            <h3 className="text-sm font-semibold text-white">Раскрыть и начать заново</h3>
            <div className="mt-3">
              <RotateSeedsForm gameSlug={game.slug} />
            </div>
          </div>

          {seeds.active && (
            <div className="card-gold rounded-2xl bg-ink-900/60 p-5">
              <h3 className="text-sm font-semibold text-white">Свой клиентский сид</h3>
              <p className="mt-1 text-xs leading-5 text-white/45">
                Смените его перед игрой — сервер обязан использовать новый, и это будет видно при
                проверке.
              </p>
              <div className="mt-3">
                <ClientSeedForm gameSlug={game.slug} current={seeds.active.clientSeed} />
              </div>
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div className="card-gold rounded-2xl bg-ink-900/60 p-5">
            <h3 className="text-sm font-semibold text-white">Проверить раунд</h3>
            {requestedRound && !revealedPair && (
              <p className="mt-2 rounded-lg border border-gold-500/25 bg-gold-500/5 px-3 py-2 text-xs text-gold-300">
                Пара этого раунда ещё не раскрыта — сид скрыт. Нажмите «Раскрыть», чтобы проверка
                стала возможной.
              </p>
            )}
            <div className="mt-3">
              <RoundVerifier prefill={prefill} />
            </div>
          </div>

          <div className="card-gold rounded-2xl bg-ink-900/60 p-5">
            <h3 className="text-sm font-semibold text-white">Последние раунды</h3>

            {rounds.rounds.length === 0 ? (
              <p className="mt-2 text-xs text-white/45">
                В этой игре вы ещё не играли. Раунды появятся здесь сразу после первой ставки.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {rounds.rounds.slice(0, 10).map((round) => (
                  <li
                    key={round.roundId}
                    className="rounded-xl border border-white/8 bg-ink-950/50 p-3"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                      <span className="font-mono text-white/60">#{round.nonce ?? '—'}</span>
                      <span className="text-white/45">
                        ставка {round.amount}
                        {round.payout ? ` · выигрыш ${round.payout}` : ''}
                      </span>
                    </div>

                    <p className="mt-2 font-mono text-[10px] break-all text-white/35">
                      {round.random ?? 'нет данных'}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {round.verifiable ? (
                        <Link
                          href={`/fairness?game=${game.slug}&round=${round.roundId}`}
                          className="rounded-lg border border-gold-500/40 bg-gold-500/15 px-3 py-1.5 text-xs font-semibold text-gold-300 hover:bg-gold-500/25"
                        >
                          Проверить
                        </Link>
                      ) : (
                        <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/35">
                          Пара не раскрыта
                        </span>
                      )}

                      {round.random && (
                        <CopyRoundButton
                          payload={[
                            `nonce: ${round.nonce}`,
                            `random: ${round.random}`,
                            `clientSeed: ${round.clientSeed}`,
                            `serverSeedHash: ${round.serverSeedHash}`,
                          ].join('\n')}
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {seeds.revealed.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-white">Раскрытые пары</h2>
          <p className="mt-1 text-sm text-white/50">
            Серверные сиды прошлых пар. Хэш каждой из них был опубликован до того, как вы сделали
            первую ставку.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {seeds.revealed.slice(0, 6).map((pair) => (
              <PairCard
                key={pair.id}
                title={`Пара от ${new Date(pair.createdAt).toLocaleDateString('ru-RU')}`}
                hash={pair.serverSeedHash}
                clientSeed={pair.clientSeed}
                nonce={pair.nonce}
                serverSeed={pair.serverSeed}
                revealedAt={pair.revealedAt}
                algorithm={pair.algorithm}
              />
            ))}
          </div>
        </section>
      )}

      <section className="mt-10 rounded-2xl border border-white/10 bg-ink-900/60 p-5 text-xs leading-6 text-white/45">
        <h2 className="text-sm font-semibold text-white">Как это работает</h2>

        <ol className="mt-3 list-decimal space-y-1.5 pl-5">
          <li>
            Портал создаёт серверный сид и сразу публикует его хэш —{' '}
            <code className="text-white/65">sha256(сид)</code>. Сам сид скрыт.
          </li>
          <li>
            У вас есть клиентский сид. Вы можете его сменить в любой момент, и сервер обязан
            использовать новый.
          </li>
          <li>
            Случайность раунда:{' '}
            <code className="text-white/65">
              HMAC-SHA256(серверный сид, клиентский сид : номер раунда)
            </code>
            . Номер растёт и не повторяется.
          </li>
          <li>
            Игра превращает это число в исход по своей таблице весов. Подсунуть своё число она не
            может: сервер знает сид и пересчитывает результат, а расхождение отклоняет ставку.
          </li>
          <li>
            Нажав «Раскрыть», вы получаете серверный сид и можете проверить каждый сыгранный раунд —
            здесь, в браузере, без участия портала.
          </li>
        </ol>

        <p className="mt-4">
          Чего эта схема не доказывает: что игра отобразила полученное число честно. За это отвечает
          автор игры, поэтому «Случайность раунда» сохраняется в журнале и её видно на этой
          странице.
        </p>

        <p className="mt-3">
          Игра: {game.title} · статус {GAME_STATUS_LABELS[game.launchable ? 'live' : 'pending']} ·{' '}
          <Link href={`/game/${game.slug}`} className="text-gold-300 hover:underline">
            открыть игру
          </Link>
        </p>
      </section>
    </main>
  )
}
