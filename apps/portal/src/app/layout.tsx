import { currency } from '@luciferus/config/currency'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { SiteHeader } from '@/components/site-header'
import './globals.css'

export const metadata: Metadata = {
  title: 'LuciferusCasinos — демо-казино на CrazyBucks',
  description:
    'Опенсорсная песочница: принеси свою игру, играй на фейковом балансе. Никаких реальных ставок и денег.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body className="ambient-glow min-h-screen antialiased">
        {/* Намеренно навязчивый баннер: баланс ненастоящий, и это не должно забываться. */}
        <div className="border-b border-gold-500/20 bg-gold-500/10 px-4 py-2 text-center text-xs tracking-wide text-gold-300">
          DEMO · {currency.symbol} {currency.name} — игровые, реальной ценности не имеют ·
          проект-песочница, не казино
        </div>

        <SiteHeader />

        {children}
      </body>
    </html>
  )
}
