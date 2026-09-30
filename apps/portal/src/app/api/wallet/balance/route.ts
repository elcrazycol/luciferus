import { NextResponse } from 'next/server'
import { getMe } from '@/lib/api'
import { getSessionToken } from '@/lib/session'

/**
 * Текущий баланс игрока для страницы игры.
 *
 * Нужен потому, что портал не узнаёт о ставках иначе: игра общается с API напрямую.
 * Пока игрок в игре, эта ручка опрашивается, и портал передаёт баланс обратно в игру
 * сообщением `casino:balance`.
 */
export async function GET() {
  const token = await getSessionToken()
  if (!token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const me = await getMe(token)
    return NextResponse.json({ balance: me.wallet.balance })
  } catch {
    return NextResponse.json({ error: 'api_unavailable' }, { status: 502 })
  }
}
