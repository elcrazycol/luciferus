import { currency } from '@luciferus/config/currency'
import { economy } from '@luciferus/config/economy'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Разработчикам — LuciferusCasinos',
  description:
    'Как подключить свою игру к порталу: SDK, хендшейк, требования к origin и локальная разработка.',
}

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-ink-950/80 p-4 text-xs leading-6 text-gold-300">
      <code>{children}</code>
    </pre>
  )
}

function Section({
  title,
  children,
  step,
}: {
  title: string
  step?: number
  children: React.ReactNode
}) {
  return (
    <section className="card-gold rounded-2xl bg-ink-900/60 p-5">
      <h2 className="flex items-center gap-3 text-base font-semibold text-white">
        {step !== undefined && (
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-gold-500/40 bg-gold-500/10 text-xs text-gold-300">
            {step}
          </span>
        )}
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-6 text-white/60">{children}</div>
    </section>
  )
}

function Prop({ name, type, children }: { name: string; type: string; children?: string }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 border-b border-white/5 py-2 last:border-0">
      <code className="text-gold-300">{name}</code>
      <code className="text-xs text-white/35">{type}</code>
      {children && <span className="w-full text-xs text-white/50">{children}</span>}
    </li>
  )
}

export default function DevelopersPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold text-white">Принеси свою игру</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">
        Портал не собирает и не хостит игры. Игра живёт у вас, на любом движке и языке, портал
        загружает её в iframe и разговаривает с ней через postMessage. Всё, что нужно от игры, —
        подключить SDK одной строкой и объявить свой origin.
      </p>

      <div className="mt-8 space-y-4">
        <Section step={1} title="Подключите SDK">
          <p>Одна строка. Дальше SDK сам поздоровается с порталом и получит сессию.</p>
          <Code>{'<script src="http://localhost:3000/sdk/v1.js" async></script>'}</Code>
          <p>
            Для сборок с типами есть пакет <code className="text-white/70">@luciferus/sdk</code> —
            он же, но с типами и без глобальной переменной.
          </p>
        </Section>

        <Section step={2} title="Объявите origin игры">
          <p>
            Портал адресует сообщения <b className="text-white/80">точно</b> на ваш origin и никогда
            в <code className="text-white/70">*</code>. Поэтому origin нужно объявить в манифесте
            игры — иначе порталу некуда здороваться, и игра просто не запустится.
          </p>
          <Code>{'"origins": ["https://my-game.example"]'}</Code>
          <p className="text-xs text-white/40">
            Origin — это схема, хост и порт, без пути. Поддомен или другой порт — уже другой origin,
            и его нужно указывать отдельно.
          </p>
        </Section>

        <Section step={3} title="Играйте с балансом">
          <p>
            К моменту загрузки вашего скрипта в{' '}
            <code className="text-white/70">window.Casinos</code> лежит готовый объект.
          </p>
          <Code>{`const c = Casinos

c.on('ready', ({ player, balance }) => ui.render(balance))
c.on('balance', ({ balance, delta }) => ui.render(balance))

// Раунд: сначала ставка, потом выплата. roundId связывает их.
const round = c.roundId()
await c.bet(10, { roundId: round })
await c.payout(150, { roundId: round })     // повтор с тем же roundId не удвоит выигрыш
await c.rollback({ roundId: round })        // если раунд сорвался в середине`}</Code>
        </Section>
      </div>

      <h2 className="mt-12 text-lg font-semibold text-white">Что доступно игре</h2>
      <ul className="mt-3 text-sm">
        <Prop name="Casinos.balance" type="number">
          Баланс. Всегда из последнего ответа сервера, не досчитан локально.
        </Prop>
        <Prop name="Casinos.player" type="{ id, username, displayName } | null" />
        <Prop name="Casinos.limits" type="{ minBet, maxBet, maxWin }">
          Лимиты вашей игры. Ставка вне их будет отклонена сервером.
        </Prop>
        <Prop name="Casinos.mode" type="'portal' | 'mock'">
          В портале — настоящий кошелёк, вне портала — локальный.
        </Prop>
        <Prop name="Casinos.bet(amount, opts)" type="Promise<RoundResult>" />
        <Prop name="Casinos.payout(amount, opts)" type="Promise<RoundResult>" />
        <Prop name="Casinos.rollback(opts)" type="Promise<RoundResult>" />
        <Prop name="Casinos.refresh()" type="Promise<number>" />
        <Prop name="Casinos.fairStart(roundId?)" type="Promise<FairRound>">
          Случайность раунда. Обязательна, если игра объявлена как провably-fair.
        </Prop>
        <Prop name="Casinos.on(event, handler)" type="() => void">
          События: ready, balance, error. Возвращает отписку.
        </Prop>
      </ul>

      <h2 className="mt-12 text-lg font-semibold text-white">Проверяемая честность</h2>
      <div className="mt-3 space-y-3 text-sm leading-6 text-white/60">
        <p>
          Объявите игру как <code className="text-white/70">provably-fair</code> — и портал начнёт
          выдавать случайность на каждый раунд, а игроки смогут проверять её сами.
        </p>
        <Code>{`const round = await c.fairStart()          // номер, коммит, клиентский сид, random
const reels = mapReels(round.random)       // ваша таблица весов

await c.bet(10, { roundId: round.roundId, fair: round })
await c.payout(win, { roundId: round.roundId })`}</Code>
        <p>
          Портал пересчитывает случайность из своего сида и сверяет с той, что приложила игра, —{' '}
          <b className="text-white/80">до списания ставки</b>. Подсунуть своё число не получится.
        </p>
        <p className="rounded-xl border border-gold-500/25 bg-gold-500/5 p-4 text-xs text-gold-300">
          Важно: превращайте <code>round.random</code> в исход детерминированно. При той же
          случайности должен получаться тот же результат — иначе проверка невозможна, и честность
          остаётся только на словах.
        </p>
      </div>

      <h2 className="mt-12 text-lg font-semibold text-white">Как это работает</h2>
      <div className="mt-3 space-y-3 text-sm leading-6 text-white/60">
        <p>
          Инициатор разговора — портал. Он знает ваш origin и отправляет{' '}
          <code className="text-white/70">casino:init</code> с одноразовым{' '}
          <code className="text-white/70">nonce</code>. SDK отвечает{' '}
          <code className="text-white/70">casino:hello</code>, вернув этот же{' '}
          <code className="text-white/70">nonce</code>, и только тогда получает сессию с игровым
          токеном.
        </p>
        <p>
          Токен ограничен вашей игрой и вашим игроком, живёт два часа и отзывается выходом из
          аккаунта. Украсть его у игры бессмысленно: она и так распоряжается только этим.
        </p>
        <p>
          Ставки и выплаты идут не через postMessage, а HTTP-запросами к{' '}
          <code className="text-white/70">/v1/game/*</code>. Так их можно ретраить: у каждой
          операции есть идентификатор раунда, и повтор не спишет деньги дважды.
        </p>
      </div>

      <h2 className="mt-12 text-lg font-semibold text-white">Разработка без портала</h2>
      <div className="mt-3 space-y-3 text-sm leading-6 text-white/60">
        <p>
          Откройте свою игру по её собственному адресу — не в iframe. SDK это заметит и поднимет
          локальный кошелёк в localStorage с {currency.symbol}
          {economy.signupBonus} на счету: ставки, выигрыши и отмены работают по тем же правилам, что
          и на сервере.
        </p>
        <p>
          Внизу справа появится отладочная панель: баланс, кнопки начисления, журнал операций.
          Панель исчезнет, если добавить <code className="text-white/70">?casino-devtools=0</code>.
        </p>
        <p className="rounded-xl border border-gold-500/25 bg-gold-500/5 p-4 text-xs text-gold-300">
          Если панель показывает «Хендшейк не удался», игра работает на локальном балансе. Внутри
          портала так быть не должно — значит, origin не объявлен или SDK не подключён.
        </p>
      </div>

      <h2 className="mt-12 text-lg font-semibold text-white">Эталонная игра</h2>
      <p className="mt-3 text-sm leading-6 text-white/60">
        Слот{' '}
        <Link href="/game/lucky-7s" className="text-gold-300 hover:underline">
          Lucky 7s
        </Link>{' '}
        — рабочая игра на ванильном TypeScript, подключённая ровно так, как описано выше. Она же
        используется в тестах проекта, поэтому не может разойтись с документацией.
      </p>

      <p className="mt-10 rounded-2xl border border-white/10 bg-ink-900/60 p-5 text-xs leading-6 text-white/45">
        Подробный гайд с манифестом и разбором ошибок лежит в репозитории:{' '}
        <code className="text-gold-300">docs/SDK.md</code>. Там же —{' '}
        <code className="text-gold-300">apps/example-game</code>, исходники эталонной игры.
      </p>
    </main>
  )
}
