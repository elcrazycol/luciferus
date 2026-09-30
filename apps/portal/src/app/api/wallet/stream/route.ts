import { getSessionToken } from '@/lib/session'

/**
 * Прокси потока баланса.
 *
 * Браузер подписывается на свой же origin, а не на API: токен сессии остаётся на
 * сервере портала, а EventSource не умеет отправлять заголовки. Заодно не нужен
 * CORS для потока.
 */

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export async function GET(request: Request) {
  const token = await getSessionToken()

  if (!token) {
    return new Response('unauthorized', { status: 401 })
  }

  let upstream: Response

  try {
    upstream = await fetch(`${API_URL}/v1/wallet/stream`, {
      headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
      // Поток должен жить до отключения клиента, а не до конца запроса.
      signal: request.signal,
    })
  } catch {
    return new Response('api_unavailable', { status: 502 })
  }

  if (!upstream.ok || !upstream.body) {
    return new Response('unavailable', { status: 502 })
  }

  return new Response(upstream.body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Отключает буферизацию у nginx: иначе события приходят пачками.
      'x-accel-buffering': 'no',
    },
  })
}
