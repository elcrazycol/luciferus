import { formatAmount } from '@luciferus/config/currency'
import Link from 'next/link'
import { BalanceChip } from '@/components/live-balance'
import { logoutAction } from '@/lib/actions'
import { getMe } from '@/lib/api'
import { getSessionToken } from '@/lib/session'

const NAV_LINKS = [
  { href: '/games', label: 'Каталог' },
  { href: '/wallet', label: 'Кошелёк' },
  { href: '/fairness', label: 'Честность' },
  { href: '/developers', label: 'Разработчикам' },
] as const

/**
 * Шапка серверная: имя и роль приходят из API.
 *
 * Баланс — единственное клиентское место: он живёт в потоке событий и меняется
 * сразу после ставки, не дожидаясь перерисовки страницы.
 */
export async function SiteHeader() {
  const token = await getSessionToken()

  // Недоступный API не должен ронять шапку — показываем гостевой вариант.
  const me = token ? await getMe(token).catch(() => null) : null

  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-ink-950/70 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-gold-gradient text-base font-black tracking-tight">LUCIFERUS</span>
        </Link>

        <nav className="flex flex-wrap items-center gap-1 text-sm">
          {NAV_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-2.5 py-1.5 text-white/55 transition-colors hover:bg-white/5 hover:text-white"
            >
              {item.label}
            </Link>
          ))}

          {me?.user.role === 'admin' && (
            <Link
              href="/admin"
              className="rounded-lg px-2.5 py-1.5 text-gold-300/80 transition-colors hover:bg-white/5 hover:text-gold-300"
            >
              Модерация
            </Link>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {me ? (
            <>
              <Link href="/wallet">
                <BalanceChip initial={me.wallet.balance} />
              </Link>

              <span className="hidden text-sm text-white/40 sm:inline">{me.user.displayName}</span>

              <form action={logoutAction}>
                <button
                  type="submit"
                  className="rounded-lg px-2.5 py-1.5 text-sm text-white/35 transition-colors hover:text-white"
                >
                  Выйти
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-lg px-2.5 py-1.5 text-sm text-white/55 transition-colors hover:text-white"
              >
                Войти
              </Link>
              <Link
                href="/register"
                className="glass glass-hover px-3 py-1.5 text-sm font-medium text-gold-300"
              >
                {formatAmount(250)} на старт
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
