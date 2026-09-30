import { currency } from '@luciferus/config/currency'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { LiveBalanceProvider } from '@/components/live-balance'
import { SiteHeader } from '@/components/site-header'
import { getSessionToken } from '@/lib/session'
import './globals.css'

export const metadata: Metadata = {
  title: 'LuciferusCasinos — демо-казино на CrazyBucks',
  description:
    'Опенсорсная песочница: принеси свою игру, играй на фейковом балансе. Никаких реальных ставок и денег.',
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Поток обновлений нужен только вошедшим: гостю он ответит 401, а EventSource
  // будет переподключаться бесконечно.
  const token = await getSessionToken()

  return (
    <html lang="ru">
      <body className="min-h-screen antialiased">
        <LiveBalanceProvider enabled={token !== null}>
          <div className="border-b border-white/5 bg-white/[0.02] px-4 py-2 text-center text-[11px] tracking-wide text-white/40">
            DEMO · {currency.symbol} {currency.name} — игровые, реальной ценности не имеют
          </div>

          <SiteHeader />

          {children}
        </LiveBalanceProvider>
      </body>
    </html>
  )
}
