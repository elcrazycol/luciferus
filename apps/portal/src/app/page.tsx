import { currency, formatAmount } from '@luciferus/config/currency'
import { economy } from '@luciferus/config/economy'
import Link from 'next/link'
import { GameCardTile } from '@/components/game-card'
import { fetchLobby } from '@/lib/api'

// Каталог должен быть свежим при каждом заходе — без этого Next отдаст статику из сборки.
export const dynamic = 'force-dynamic'

function OfflineNotice() {
  return (
    <div className="rounded-2xl border border-ember-500/25 bg-ember-500/5 p-6">
      <h2 className="text-lg font-semibold text-white">API не отвечает</h2>
      <p className="mt-1 text-sm text-white/60">
        Портал работает, а вот бэкенд или база не подняты — поэтому каталог пуст. Запусти три
        команды, и здесь появятся игры:
      </p>

      <pre className="mt-4 overflow-x-auto rounded-xl border border-white/10 bg-ink-950/80 p-4 text-xs leading-6 text-gold-300">
        <code>
          bun run infra:up{'\n'}
          bun run db:migrate{'\n'}
          bun run db:seed
        </code>
      </pre>

      <p className="mt-3 text-xs text-white/40">
        Ожидаемый адрес API: <code className="text-white/60">http://localhost:3001</code>
      </p>
    </div>
  )
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card-gold rounded-2xl bg-ink-900/60 p-4">
      <p className="text-[11px] tracking-wider text-white/40 uppercase">{label}</p>
      <p className="text-gold-gradient mt-1 text-2xl font-bold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-white/40">{hint}</p>}
    </div>
  )
}

export default async function LobbyPage() {
  const { games, online } = await fetchLobby()
  const providerCount = new Set(games.map((game) => game.providerName).filter(Boolean)).size

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pt-10 pb-24 sm:px-6 lg:px-8">
      <section>
        <h1 className="max-w-3xl text-3xl font-bold text-white sm:text-4xl">
          Казино, где проиграть нельзя. Потому что играть{' '}
          <span className="text-gold-gradient">не на что</span>.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">
          Платформа для чужих игр: принеси свой слот, краш или настолку, подключи одной строкой кода
          — портал даст тебе баланс игрока, ставки, выплаты, чат и проверяемый рандом. Баланс
          фейковый, вайб настоящий.
        </p>
      </section>

      <section className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="стартовый бонус"
          value={formatAmount(economy.signupBonus)}
          hint="каждому новому аккаунту"
        />
        <StatCard
          label="дозаправка"
          value={formatAmount(economy.reloadBonus)}
          hint={`раз в ${economy.reloadCooldownMinutes} минут, если всё слил`}
        />
        <StatCard
          label="игр в каталоге"
          value={online ? String(games.length) : '—'}
          hint={online ? `от ${providerCount} провайдеров` : 'API недоступен'}
        />
        <StatCard label="реальные деньги" value="C$0" hint="и так и останется" />
      </section>

      <section className="mt-10">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-white">Каталог</h2>
          <p className="text-xs text-white/40">
            {online ? 'данные из Postgres через API' : 'нет соединения с API'}
          </p>
        </div>

        {online && games.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {games.map((game) => (
              <GameCardTile key={game.slug} game={game} />
            ))}
          </div>
        )}

        {online && games.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-ink-900/60 p-6 text-sm text-white/60">
            В базе нет ни одной опубликованной игры. Запусти{' '}
            <code className="text-gold-300">bun run db:seed</code>, чтобы залить три заглушки.
          </div>
        )}

        {!online && <OfflineNotice />}
      </section>

      <section className="mt-14 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card-gold rounded-2xl bg-ink-900/60 p-5 lg:col-span-2">
          <h2 className="text-lg font-semibold text-white">Что уже работает</h2>
          <ol className="mt-4 space-y-3 text-sm text-white/60">
            <li>
              <span className="font-medium text-white/85">Кошелёк.</span> Регистрация, сессии,
              журнал всех операций и стартовый бонус {formatAmount(economy.signupBonus)}.
            </li>
            <li>
              <span className="font-medium text-white/85">SDK и запуск игр.</span> Игра подключается
              одной строкой, получает баланс игрока и играет по-настоящему: ставки и выплаты идут
              через кошелёк портала. Работает — попробуй{' '}
              <Link href="/game/lucky-7s" className="text-gold-300 hover:underline">
                Lucky 7s
              </Link>
              .
            </li>
            <li>
              <span className="font-medium text-white/85">
                Дальше — каталог, честность, realtime.
              </span>{' '}
              Регистрация игр и модерация, страница верификации раундов, чат, лента выигрышей.
            </li>
          </ol>
        </div>

        <div className="card-gold rounded-2xl bg-ink-900/60 p-5">
          <h2 className="text-lg font-semibold text-white">Хочешь свою игру?</h2>
          <p className="mt-2 text-sm text-white/60">
            Игра хостится у тебя, портал грузит её в iframe и общается через postMessage. Любой
            движок, любой язык, любой хостинг.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-xl border border-white/10 bg-ink-950/80 p-4 text-xs text-gold-300">
            <code>{'<script src="http://localhost:3000/sdk/v1.js" async />'}</code>
          </pre>
          <Link
            href="/developers"
            className="mt-3 inline-block text-xs text-gold-300 hover:underline"
          >
            Как подключить — гайд и живой пример
          </Link>
        </div>
      </section>

      <footer className="mt-14 border-t border-white/5 pt-6 text-xs text-white/35">
        LuciferusCasinos · MIT · {currency.symbol} {currency.name} не имеют реальной ценности · это
        учебная песочница, а не казино
      </footer>
    </main>
  )
}
