import { basename, dirname, resolve } from 'node:path'

export type BuildSdkOptions = {
  /** Куда положить бандл. Каталог создаётся автоматически. */
  outfile: string
  minify?: boolean
  sourcemap?: boolean
}

export type BuildSdkResult = {
  outfile: string
  bytes: number
}

/**
 * Собирает SDK в один самодостаточный файл для `<script src>`.
 *
 * Вынесено в функцию, потому что бандл нужен в двух местах: пакет кладёт его
 * к себе в `dist` (для npm и CDN), а портал — в свой `public/sdk` (для строки
 * подключения). Общая реализация гарантирует, что это буквально один и тот же файл.
 */
export async function buildSdk(options: BuildSdkOptions): Promise<BuildSdkResult> {
  const outfile = resolve(options.outfile)

  const result = await Bun.build({
    entrypoints: [resolve(import.meta.dir, 'index.ts')],
    target: 'browser',
    format: 'iife',
    minify: options.minify ?? true,
    sourcemap: options.sourcemap ? 'linked' : 'none',
    naming: basename(outfile),
    outdir: dirname(outfile),
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
  })

  if (!result.success) {
    const details = result.logs.map((log) => String(log)).join('\n')
    throw new Error(`Не удалось собрать SDK:\n${details}`)
  }

  const output = result.outputs.find((artifact) => artifact.path === outfile)

  return {
    outfile,
    bytes: output ? (await output.arrayBuffer()).byteLength : 0,
  }
}
