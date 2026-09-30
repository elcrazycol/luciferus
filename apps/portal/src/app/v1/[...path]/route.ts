import type { NextRequest } from 'next/server'

/**
 * Единая точка входа для API.
 *
 * Игры обращаются к API напрямую из браузера, поэтому API обязан быть доступен
 * снаружи. Проксировать его через портал, а не заводить второй домен, стоит по
 * двум причинам:
 *
 * 1. Один домен — одна запись в DNS и один маршрут в туннеле. Для self-host
 *    это заметно меньше движущихся частей.
 * 2. Запросы портала и игры идут с одного origin, поэтому CORS перестаёт быть
 *    источником загадочных отказов в браузере.
 *
 * Цена — лишний хоп через сервер портала. Для площадки с фейковым балансом это
 * дешевле, чем сложность второго домена.
 */

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

/** Заголовки, которые нельзя переносить: они описывают конкретное соединение. */
const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  const search = new URL(request.url).search
  const target = `${API_URL}/v1/${path.join('/')}${search}`

  const headers = new Headers(request.headers)
  for (const name of HOP_BY_HOP) headers.delete(name)

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'

  let upstream: Response

  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      // Тело читаем целиком: запросы к API маленькие, а потоковая передача
      // потребовала бы duplex-режима, который поддерживается не везде.
      ...(hasBody ? { body: await request.arrayBuffer() } : {}),
      // Поток баланса — SSE, его нельзя буферизовать.
      signal: request.signal,
    })
  } catch (error) {
    return Response.json(
      {
        error: 'internal_error',
        message: 'API недоступен',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    )
  }

  const responseHeaders = new Headers(upstream.headers)
  // Длину и сжатие пересчитает Next: после проксирования они уже неверны.
  responseHeaders.delete('content-length')
  responseHeaders.delete('content-encoding')

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  })
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
export const OPTIONS = proxy
export const HEAD = proxy

export const dynamic = 'force-dynamic'
