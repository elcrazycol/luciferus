import { formatAmount } from '@luciferus/config/currency'
import Link from 'next/link'
import { logoutAction } from '@/lib/actions'
import { getMe } from '@/lib/api'
import { getSessionToken } from '@/lib/session'

const NAV_LINKS = [
  { href: '/', label: 'Лобби' },
  { href: '/games', label: 'Каталог' },
  { href: '/wallet', label: 'Кошелёк' },
  { href: '/developers', label: 'Разработчикам' },
] as const

const COMING_SOON = ['Промо', 'Лидерборды'] as const

/** Шапка серверная: баланс и имя приходят из API, а не из клиентского состояния. */
export async function SiteHeader() {
  const token = await getSessionToken()

  // Недоступный API не должен ронять шапку — показываем гостевой вариант.
  const me = token ? await getMe(token).catch(() => null) : null

  return (
    <header className="sticky top-0 z-20 border-b border-white/5 bg-ink-950/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="text-xl">🎰</span>
          <span className="text-gold-gradient text-lg font-black tracking-tight">LUCIFERUS</span>
        </Link>

        <nav className="flex flex-wrap items-center gap-1">
          {NAV_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-1.5 text-sm text-white/60 transition-colors hover:bg-white/5 hover:text-white"
            >
              {item.label}
            </Link>
          ))}

          {me?.user.role === 'admin' && (
            <Link
              href="/admin"
              className="rounded-lg border border-gold-500/30 px-3 py-1.5 text-sm text-gold-300 transition-colors hover:bg-gold-500/10"
            >
              Модерация
            </Link>
          )}

          {COMING_SOON.map((label) => (
            <span
              key={label}
              title="Появится в следующих фазах"
              className="cursor-not-allowed rounded-lg px-3 py-1.5 text-sm text-white/25"
            >
              {label}
            </span>
          ))}
        </nav>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {me ? (
            <>
              <Link
                href="/wallet"
                title="Открыть кошелёк"
                className="rounded-lg border border-gold-500/30 bg-gold-500/10 px-3 py-1.5 text-sm font-semibold text-gold-300 transition-colors hover:bg-gold-500/20"
              >
                {formatAmount(me.wallet.balance)}
              </Link>

              <span className="hidden text-sm text-white/50 sm:inline">{me.user.displayName}</span>

              <form action={logoutAction}>
                <button
                  type="submit"
                  className="rounded-lg px-3 py-1.5 text-sm text-white/40 transition-colors hover:text-white"
                >
                  Выйти
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-lg px-3 py-1.5 text-sm text-white/60 transition-colors hover:text-white"
              >
                Войти
              </Link>
              <Link
                href="/register"
                className="rounded-lg border border-gold-500/40 bg-gold-500/15 px-3 py-1.5 text-sm font-semibold text-gold-300 transition-colors hover:bg-gold-500/25"
              >
                Забрать C$250
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
