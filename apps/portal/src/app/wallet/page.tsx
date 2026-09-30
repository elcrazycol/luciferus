import { currency, formatAmount } from '@luciferus/config/currency'
import { LEDGER_TYPE_LABELS } from '@luciferus/protocol/wallet'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ReloadBonusButton } from '@/components/reload-bonus-button'
import { ApiRequestError, getLedger, getWalletOverview } from '@/lib/api'
import { getSessionToken } from '@/lib/session'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Кошелёк — LuciferusCasinos',
}

function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Знак и цвет: списание красным, начисление зелёным. */
function AmountCell({ value }: { value: string }) {
  const negative = value.startsWith('-')

  return (
    <span className={`font-medium tabular-nums ${negative ? 'text-ember-500' : 'text-mint-500'}`}>
      {negative ? '−' : '+'}
      {formatAmount(negative ? value.slice(1) : value)}
    </span>
  )
}

function ApiDownNotice({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-ember-500/25 bg-ember-500/5 p-6">
      <h2 className="text-lg font-semibold text-white">API не отвечает</h2>
      <p className="mt-1 text-sm text-white/60">{message}</p>
      <pre className="mt-4 overflow-x-auto rounded-xl border border-white/10 bg-ink-950/80 p-4 text-xs leading-6 text-gold-300">
        <code>
          bun run infra:up{'\n'}
          bun run db:migrate{'\n'}
          bun run db:seed{'\n'}
          bun run dev
        </code>
      </pre>
    </div>
  )
}

export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>
}) {
  const token = await getSessionToken()
  if (!token) redirect('/login')

  let overview: Awaited<ReturnType<typeof getWalletOverview>>

  try {
    overview = await getWalletOverview(token)
  } catch (error) {
    // Баланс — то, ради чего страница существует. Без него показывать нечего.
    console.error('[portal] не удалось загрузить кошелёк:', error)
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
        <ApiDownNotice
          message={
            error instanceof ApiRequestError ? error.message : 'Не удалось загрузить кошелёк'
          }
        />
      </main>
    )
  }

  // История вторична: если она не пришла, баланс и дозаправка обязаны работать.
  const ledger = await getLedger(token, 20).catch((error: unknown) => {
    console.error('[portal] не удалось загрузить историю операций:', error)
    return null
  })

  const { welcome } = await searchParams
  const { wallet, recentEntries } = overview
  const reload = wallet.reload

  const reloadHint =
    reload.blockedBy === 'balance_above_threshold'
      ? `Дозаправка включается, когда баланс упадёт ниже ${formatAmount(reload.threshold)}`
      : reload.blockedBy === 'cooldown'
        ? `Следующая дозаправка: ${reload.availableAt ? formatMoment(reload.availableAt) : 'скоро'}`
        : `Раз в ${reload.cooldownMinutes} минут, если всё слил`

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      {welcome === '1' && (
        <div className="mb-6 rounded-2xl border border-mint-500/30 bg-mint-500/10 px-5 py-4">
          <p className="font-semibold text-mint-500">
            Аккаунт создан. На счёт зачислено {formatAmount(reload.bonusAmount)} стартового бонуса.
          </p>
          <p className="mt-1 text-sm text-white/60">
            Это {currency.name} — игровая валюта. Купить, продать или вывести её нельзя.
          </p>
        </div>
      )}

      <h1 className="text-2xl font-bold text-white">Кошелёк</h1>
      <p className="mt-1 text-sm text-white/50">
        Каждое движение баланса записано в журнал. Баланс нельзя изменить в обход него.
      </p>

      <div className="mt-7 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="glass rounded-2xl bg-ink-900/70 p-6 lg:col-span-2">
          <p className="text-[11px] tracking-wider text-white/40 uppercase">Текущий баланс</p>
          <p className="text-gold-gradient mt-1 text-4xl font-black tabular-nums">
            {formatAmount(wallet.balance)}
          </p>
          <p className="mt-2 text-xs text-white/40">
            {currency.code} · {currency.name} · не имеющие ценности
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3 border-t border-white/5 pt-4 text-sm">
            <div>
              <p className="text-xs text-white/40">Операций в истории</p>
              <p className="text-white/80">{recentEntries.length} последних</p>
            </div>
            <div>
              <p className="text-xs text-white/40">Порог дозаправки</p>
              <p className="text-white/80">{formatAmount(reload.threshold)}</p>
            </div>
          </div>
        </div>

        <div className="glass flex flex-col justify-between rounded-2xl bg-ink-900/70 p-6">
          <div>
            <p className="text-[11px] tracking-wider text-white/40 uppercase">Дозаправка</p>
            <p className="text-gold-gradient mt-1 text-2xl font-bold">
              +{formatAmount(reload.bonusAmount)}
            </p>
          </div>

          <div className="mt-6">
            <ReloadBonusButton
              disabled={!reload.available}
              label={reload.available ? 'Заправиться' : 'Недоступно'}
              hint={reloadHint}
            />
          </div>
        </div>
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-white">История операций</h2>

        {!ledger ? (
          <p className="mt-4 rounded-2xl border border-ember-500/25 bg-ember-500/5 p-6 text-sm text-white/60">
            Историю операций не удалось загрузить. Баланс выше — верный, журнал подтянется при
            обновлении страницы.
          </p>
        ) : ledger.entries.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-white/10 bg-ink-900/60 p-6 text-sm text-white/50">
            Пока пусто. Сыграйте в любую игру — операции появятся здесь.
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-left text-[11px] tracking-wider text-white/40 uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">Операция</th>
                  <th className="hidden px-4 py-3 font-medium sm:table-cell">Раунд</th>
                  <th className="px-4 py-3 text-right font-medium">Сумма</th>
                  <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">
                    После операции
                  </th>
                  <th className="px-4 py-3 text-right font-medium">Когда</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/5">
                {ledger.entries.map((entry) => (
                  <tr key={entry.id} className="bg-ink-900/40">
                    <td className="px-4 py-3 text-white/80">
                      {LEDGER_TYPE_LABELS[entry.type] ?? entry.type}
                      {entry.gameSlug && (
                        <span className="ml-2 text-xs text-white/35">{entry.gameSlug}</span>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 font-mono text-xs text-white/35 sm:table-cell">
                      {entry.roundId ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <AmountCell value={entry.amount} />
                    </td>
                    <td className="hidden px-4 py-3 text-right tabular-nums text-white/50 sm:table-cell">
                      {formatAmount(entry.balanceAfter)}
                    </td>
                    <td className="px-4 py-3 text-right text-xs whitespace-nowrap text-white/35">
                      {formatMoment(entry.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {ledger?.nextCursor && (
          <p className="mt-3 text-xs text-white/35">
            Показаны последние 20 операций. Постраничная навигация появится вместе с профилем.
          </p>
        )}
      </section>
    </main>
  )
}
