import { resolve } from 'node:path'

/**
 * Dev-сервер эталонной игры.
 *
 * Собирает клиентский код и раздаёт статику. Игра живёт на отдельном origin —
 * ровно как настоящая сторонняя игра, — иначе проверка origin в хендшейке
 * ничего бы не проверяла.
 */

const PORT = Number(process.env.EXAMPLE_GAME_PORT ?? 4000)
const PORTAL_URL = process.env.PORTAL_URL ?? 'http://localhost:3000'
const SOURCE_DIR = resolve(import.meta.dir, 'src')
const PUBLIC_DIR = resolve(import.meta.dir, 'public')

async function build(): Promise<void> {
  const result = await Bun.build({
    entrypoints: [resolve(SOURCE_DIR, 'game.ts')],
    target: 'browser',
    format: 'esm',
    minify: false,
    sourcemap: 'inline',
    outdir: PUBLIC_DIR,
    naming: 'game.js',
  })

  if (!result.success) {
    const details = result.logs.map((log) => String(log)).join('\n')
    throw new Error(`Не удалось собрать игру:\n${details}`)
  }

  console.log('🔨 Игра собрана: public/game.js')
}

await build()

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
}

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.')
  return CONTENT_TYPES[path.slice(dot)] ?? 'application/octet-stream'
}

const server = Bun.serve({
  port: PORT,

  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = await Bun.file(resolve(SOURCE_DIR, 'index.html')).text()

      // __GAME_BASE__ пустой: локально игра живёт в корне своего домена.
      return new Response(
        html.replaceAll('__PORTAL_URL__', PORTAL_URL).replaceAll('__GAME_BASE__', ''),
        {
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        },
      )
    }

    const requested = resolve(PUBLIC_DIR, `.${url.pathname}`)

    // Раздача статики не должна выводить за пределы каталога игры: `..` в пути
    // иначе отдал бы любой файл с диска.
    if (!requested.startsWith(`${PUBLIC_DIR}/`)) {
      return new Response('Forbidden', { status: 403 })
    }

    const file = Bun.file(requested)
    if (!(await file.exists())) {
      return new Response('Not found', { status: 404 })
    }

    return new Response(file, {
      headers: { 'content-type': contentTypeFor(requested), 'cache-control': 'no-store' },
    })
  },
})

console.log(`🎰 Эталонная игра: http://localhost:${server.port}`)
console.log(`   портал ожидается на ${PORTAL_URL}`)
console.log('   открыть напрямую — SDK уйдёт в мок-режим с локальным кошельком')
