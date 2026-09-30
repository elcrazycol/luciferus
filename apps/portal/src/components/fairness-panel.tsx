'use client'

import { verifyRound } from '@luciferus/fairness'
import { useActionState, useState } from 'react'
import { FormError, FormSuccess } from '@/components/form-field'
import { rotateSeedsAction, type SeedsFormState, setClientSeedAction } from '@/lib/fairness-actions'

const INITIAL: SeedsFormState = {}

type Prefill = {
  serverSeed?: string
  serverSeedHash?: string
  clientSeed?: string
  nonce?: number
  random?: string
}

const FIELD_CLASS =
  'w-full rounded-lg border border-white/10 bg-ink-950/80 px-3 py-2 font-mono text-xs text-white outline-none placeholder:text-white/25 focus:border-gold-500/60'

/**
 * Проверка раунда прямо в браузере.
 *
 * Ключевое: расчёт идёт здесь, а не на сервере. Игрок вводит три значения и
 * получает результат, не доверяя порталу ни на шаг — в этом и смысл проверяемой
 * честности. Если бы проверку считал сервер, он мог бы соврать и в ней.
 */
export function RoundVerifier({ prefill }: { prefill?: Prefill }) {
  const [values, setValues] = useState({
    serverSeed: prefill?.serverSeed ?? '',
    serverSeedHash: prefill?.serverSeedHash ?? '',
    clientSeed: prefill?.clientSeed ?? '',
    nonce: prefill?.nonce ? String(prefill.nonce) : '',
    random: prefill?.random ?? '',
  })

  const [result, setResult] = useState<{
    seedMatchesCommit: boolean
    randomMatches: boolean
    computedRandom: string
  } | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function update(field: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    setResult(null)
    setError(null)
  }

  async function check() {
    const nonce = Number.parseInt(values.nonce, 10)

    if (!values.serverSeed.trim()) return setError('Введите серверный сид')
    if (!/^[0-9a-f]{64}$/i.test(values.serverSeedHash.trim())) {
      return setError('Хэш сида — ровно 64 hex-символа')
    }
    if (!/^[0-9a-f]{64}$/i.test(values.random.trim())) {
      return setError('Случайность раунда — ровно 64 hex-символа')
    }
    if (!Number.isInteger(nonce) || nonce < 1) return setError('Номер раунда — целое число от 1')

    setBusy(true)
    setError(null)

    try {
      const verification = await verifyRound({
        serverSeed: values.serverSeed.trim(),
        serverSeedHash: values.serverSeedHash.trim(),
        clientSeed: values.clientSeed,
        nonce,
        claimedRandom: values.random.trim(),
      })

      setResult(verification)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось посчитать')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] tracking-wider text-white/45 uppercase">
            Серверный сид (раскрытый)
          </span>
          <input
            value={values.serverSeed}
            onChange={(event) => update('serverSeed', event.target.value)}
            placeholder="64 hex-символа"
            className={FIELD_CLASS}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] tracking-wider text-white/45 uppercase">
            Опубликованный хэш
          </span>
          <input
            value={values.serverSeedHash}
            onChange={(event) => update('serverSeedHash', event.target.value)}
            placeholder="64 hex-символа"
            className={FIELD_CLASS}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] tracking-wider text-white/45 uppercase">
            Клиентский сид
          </span>
          <input
            value={values.clientSeed}
            onChange={(event) => update('clientSeed', event.target.value)}
            className={FIELD_CLASS}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] tracking-wider text-white/45 uppercase">
            Номер раунда
          </span>
          <input
            value={values.nonce}
            onChange={(event) => update('nonce', event.target.value)}
            inputMode="numeric"
            className={FIELD_CLASS}
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-[11px] tracking-wider text-white/45 uppercase">
          Случайность раунда из журнала
        </span>
        <input
          value={values.random}
          onChange={(event) => update('random', event.target.value)}
          placeholder="64 hex-символа"
          className={FIELD_CLASS}
        />
      </label>

      <button
        type="button"
        onClick={() => void check()}
        disabled={busy}
        className="w-full rounded-xl border border-gold-500/40 bg-gold-500/15 px-4 py-2.5 text-sm font-semibold text-gold-300 transition-colors enabled:hover:bg-gold-500/25 disabled:opacity-60"
      >
        {busy ? 'Считаем в браузере…' : 'Проверить в браузере'}
      </button>

      {error && (
        <p className="rounded-xl border border-ember-500/30 bg-ember-500/10 px-4 py-2.5 text-sm text-ember-500">
          {error}
        </p>
      )}

      {result && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            result.seedMatchesCommit && result.randomMatches
              ? 'border-mint-500/30 bg-mint-500/10 text-mint-500'
              : 'border-ember-500/30 bg-ember-500/10 text-ember-500'
          }`}
        >
          <p className="font-semibold">
            {result.seedMatchesCommit && result.randomMatches
              ? 'Раунд честный'
              : 'Раунд не сходится'}
          </p>

          <ul className="mt-2 space-y-1 text-xs">
            <li>
              {result.seedMatchesCommit ? '✓' : '✗'} хэш раскрытого сида совпадает с опубликованным
            </li>
            <li>{result.randomMatches ? '✓' : '✗'} случайность совпадает с пересчитанной</li>
          </ul>

          {!result.randomMatches && (
            <p className="mt-2 font-mono text-[11px] break-all">
              Получилось: {result.computedRandom}
            </p>
          )}
        </div>
      )}

      <p className="text-[11px] leading-5 text-white/35">
        Расчёт идёт целиком в вашем браузере: сервер в нём не участвует и подделать результат не
        может. Формула —{' '}
        <code className="text-white/55">HMAC-SHA256(серверный сид, клиентский сид : номер)</code>.
      </p>
    </div>
  )
}

/** Копирует данные раунда одной строкой — удобно перенести в чужую проверку. */
export function CopyRoundButton({ payload }: { payload: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          .writeText(payload)
          .then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
          .catch(() => setCopied(false))
      }}
      className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/10"
    >
      {copied ? 'Скопировано' : 'Копировать'}
    </button>
  )
}

export function RotateSeedsForm({ gameSlug }: { gameSlug: string }) {
  const [state, action, pending] = useActionState(rotateSeedsAction, INITIAL)

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="gameSlug" value={gameSlug} />

      <label className="block">
        <span className="mb-1 block text-[11px] tracking-wider text-white/45 uppercase">
          Новый клиентский сид (необязательно)
        </span>
        <input
          name="clientSeed"
          placeholder="оставьте пустым — сгенерируем"
          className={FIELD_CLASS}
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl border border-gold-500/40 bg-gold-500/15 px-4 py-2.5 text-sm font-semibold text-gold-300 transition-colors enabled:hover:bg-gold-500/25 disabled:opacity-60"
      >
        {pending ? 'Раскрываем…' : 'Раскрыть текущий сид и начать новую пару'}
      </button>

      <p className="text-[11px] leading-5 text-white/35">
        Раскрытие необратимо: серверный сид станет публичным навсегда — только так можно проверить
        уже сыгранные раунды. Номер раунда начнётся заново.
      </p>

      <FormError message={state.error} />
      <FormSuccess message={state.success} />
    </form>
  )
}

export function ClientSeedForm({ gameSlug, current }: { gameSlug: string; current: string }) {
  const [state, action, pending] = useActionState(setClientSeedAction, INITIAL)

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="gameSlug" value={gameSlug} />

      <label className="block">
        <span className="mb-1 block text-[11px] tracking-wider text-white/45 uppercase">
          Клиентский сид
        </span>
        <input name="clientSeed" defaultValue={current} className={FIELD_CLASS} />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/75 transition-colors enabled:hover:bg-white/10 disabled:opacity-60"
      >
        {pending ? 'Сохраняем…' : 'Сменить клиентский сид'}
      </button>

      <FormError message={state.error} />
      <FormSuccess message={state.success} />
    </form>
  )
}
