'use client'

import { verifyRound } from '@luciferus/fairness'
import { useActionState, useEffect, useState } from 'react'
import { FormError, FormSuccess } from '@/components/form-field'
import { rotateSeedsAction, type SeedsFormState, setClientSeedAction } from '@/lib/fairness-actions'

const INITIAL: SeedsFormState = {}

const FIELD =
  'w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 font-mono text-xs text-white outline-none placeholder:text-white/25 focus:border-gold-500/50'

export type VerifierPrefill = {
  serverSeed?: string
  serverSeedHash?: string
  clientSeed?: string
  nonce?: number
  random?: string
}

type Verdict = {
  seedMatchesCommit: boolean
  randomMatches: boolean
  computedRandom: string
}

async function compute(prefill: VerifierPrefill): Promise<Verdict | { error: string }> {
  const nonce = prefill.nonce ?? 0

  if (!prefill.serverSeed) return { error: 'Нет раскрытого серверного сида' }
  if (!/^[0-9a-f]{64}$/i.test(prefill.serverSeedHash ?? '')) return { error: 'Хэш сида неверен' }
  if (!/^[0-9a-f]{64}$/i.test(prefill.random ?? '')) return { error: 'Случайность раунда неверна' }
  if (!Number.isInteger(nonce) || nonce < 1) return { error: 'Номер раунда неверен' }

  return verifyRound({
    serverSeed: prefill.serverSeed,
    serverSeedHash: prefill.serverSeedHash ?? '',
    clientSeed: prefill.clientSeed ?? '',
    nonce,
    claimedRandom: prefill.random ?? '',
  })
}

function VerdictCard({ verdict }: { verdict: Verdict }) {
  const honest = verdict.seedMatchesCommit && verdict.randomMatches

  return (
    <div className={`glass px-4 py-3 text-sm ${honest ? 'text-mint-500' : 'text-ember-500'}`}>
      <p className="font-semibold">{honest ? 'Раунд честный' : 'Раунд не сходится'}</p>

      <ul className="mt-2 space-y-1 text-xs text-white/55">
        <li>
          {verdict.seedMatchesCommit ? '✓' : '✗'} хэш раскрытого сида совпадает с опубликованным
        </li>
        <li>{verdict.randomMatches ? '✓' : '✗'} случайность совпадает с пересчитанной</li>
      </ul>

      {!verdict.randomMatches && (
        <p className="mt-2 font-mono text-[11px] break-all text-white/40">
          Получилось: {verdict.computedRandom}
        </p>
      )}
    </div>
  )
}

/**
 * Проверка раунда.
 *
 * Считается в браузере, а не на сервере: иначе портал мог бы соврать и в проверке,
 * и весь смысл проверяемой честности пропал бы.
 *
 * Если данные пришли из журнала, проверка выполняется сразу — игроку не нужно
 * нажимать кнопку, чтобы увидеть вердикт. Ручной ввод нужен только для чужих
 * раундов и спрятан, пока не понадобится.
 */
export function RoundVerifier({ prefill }: { prefill?: VerifierPrefill }) {
  const prefillKey = prefill ? JSON.stringify(prefill) : ''

  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [manualOpen, setManualOpen] = useState(!prefill?.serverSeed)

  const [manual, setManual] = useState<VerifierPrefill>({})

  // Автопроверка при открытии страницы с готовыми данными.
  useEffect(() => {
    if (!prefillKey) return

    let cancelled = false
    setBusy(true)
    setError(null)

    void (async () => {
      const outcome = await compute(JSON.parse(prefillKey) as VerifierPrefill)
      if (cancelled) return

      if ('error' in outcome) setError(outcome.error)
      else setVerdict(outcome)

      setBusy(false)
    })()

    return () => {
      cancelled = true
    }
  }, [prefillKey])

  async function checkManual() {
    setBusy(true)
    setError(null)
    setVerdict(null)

    const outcome = await compute(manual)

    if ('error' in outcome) setError(outcome.error)
    else setVerdict(outcome)

    setBusy(false)
  }

  return (
    <div className="space-y-3">
      {busy && <p className="text-sm text-white/45">Считаем в браузере…</p>}

      {error && !manualOpen && <p className="glass px-4 py-3 text-sm text-gold-300">{error}</p>}

      {verdict && <VerdictCard verdict={verdict} />}

      <button
        type="button"
        onClick={() => setManualOpen((open) => !open)}
        className="text-xs text-white/40 transition-colors hover:text-white"
      >
        {manualOpen ? 'Скрыть ручную проверку' : 'Проверить чужой раунд вручную'}
      </button>

      {manualOpen && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] text-white/40">Серверный сид</span>
              <input
                value={manual.serverSeed ?? ''}
                onChange={(event) => setManual({ ...manual, serverSeed: event.target.value })}
                placeholder="64 hex-символа"
                className={FIELD}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] text-white/40">Опубликованный хэш</span>
              <input
                value={manual.serverSeedHash ?? ''}
                onChange={(event) => setManual({ ...manual, serverSeedHash: event.target.value })}
                placeholder="64 hex-символа"
                className={FIELD}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] text-white/40">Клиентский сид</span>
              <input
                value={manual.clientSeed ?? ''}
                onChange={(event) => setManual({ ...manual, clientSeed: event.target.value })}
                className={FIELD}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] text-white/40">Номер раунда</span>
              <input
                value={manual.nonce ?? ''}
                onChange={(event) =>
                  setManual({ ...manual, nonce: Number.parseInt(event.target.value, 10) || 0 })
                }
                inputMode="numeric"
                className={FIELD}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-[11px] text-white/40">
              Случайность раунда из журнала
            </span>
            <input
              value={manual.random ?? ''}
              onChange={(event) => setManual({ ...manual, random: event.target.value })}
              placeholder="64 hex-символа"
              className={FIELD}
            />
          </label>

          <button
            type="button"
            onClick={() => void checkManual()}
            disabled={busy}
            className="w-full rounded-xl border border-white/12 bg-white/6 px-4 py-2.5 text-sm text-white/80 transition-colors enabled:hover:bg-white/10 disabled:opacity-50"
          >
            Проверить
          </button>

          {error && manualOpen && (
            <p className="glass px-4 py-2.5 text-sm text-ember-500">{error}</p>
          )}
        </div>
      )}

      <p className="text-[11px] leading-5 text-white/30">
        Считает ваш браузер. Формула:{' '}
        <span className="font-mono">HMAC-SHA256(серверный сид, клиентский сид : номер)</span>
      </p>
    </div>
  )
}

/** Раскрытие текущей пары. Главное действие на странице, поэтому выглядит как главное. */
export function RotateSeedsForm({
  gameSlug,
  roundsWaiting,
}: {
  gameSlug: string
  roundsWaiting: number
}) {
  const [state, action, pending] = useActionState(rotateSeedsAction, INITIAL)

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="gameSlug" value={gameSlug} />

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl border border-gold-500/40 bg-gold-500/15 px-4 py-3 text-sm font-semibold text-gold-300 transition-colors enabled:hover:bg-gold-500/25 disabled:opacity-60"
      >
        {pending
          ? 'Раскрываем…'
          : roundsWaiting > 0
            ? `Раскрыть сид и проверить ${roundsWaiting} раундов`
            : 'Раскрыть сид и начать новую пару'}
      </button>

      <label className="block">
        <span className="mb-1 block text-[11px] text-white/40">
          Новый клиентский сид — необязательно
        </span>
        <input name="clientSeed" placeholder="оставьте пустым — сгенерируем" className={FIELD} />
      </label>

      <FormError message={state.error} />
      <FormSuccess message={state.success} />
    </form>
  )
}

export function ClientSeedForm({ gameSlug, current }: { gameSlug: string; current: string }) {
  const [state, action, pending] = useActionState(setClientSeedAction, INITIAL)

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="gameSlug" value={gameSlug} />

      <div className="flex flex-wrap gap-2">
        <input name="clientSeed" defaultValue={current} className={`${FIELD} flex-1`} />

        <button
          type="submit"
          disabled={pending}
          className="rounded-xl border border-white/12 bg-white/6 px-4 py-2 text-sm text-white/75 transition-colors enabled:hover:bg-white/10 disabled:opacity-50"
        >
          {pending ? 'Сохраняем…' : 'Сменить'}
        </button>
      </div>

      <FormError message={state.error} />
      <FormSuccess message={state.success} />
    </form>
  )
}

/** Копирует данные раунда — удобно перенести в чужую проверку. */
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
      className="text-[11px] text-white/35 transition-colors hover:text-white"
    >
      {copied ? 'скопировано' : 'копировать'}
    </button>
  )
}
