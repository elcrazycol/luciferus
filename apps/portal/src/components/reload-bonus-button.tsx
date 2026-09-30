'use client'

import { useActionState } from 'react'
import { claimReloadAction, type ReloadState } from '@/lib/actions'

const INITIAL: ReloadState = {}

/**
 * Кнопка дозаправки. Клиентская, потому что должна показать причину отказа:
 * кулдаун ещё идёт или кто-то успел забрать бонус раньше.
 */
export function ReloadBonusButton({
  disabled,
  label,
  hint,
}: {
  disabled: boolean
  label: string
  hint: string
}) {
  const [state, action, pending] = useActionState(claimReloadAction, INITIAL)

  return (
    <form action={action} className="w-full">
      <button
        type="submit"
        disabled={disabled || pending}
        className="w-full rounded-xl border border-gold-500/40 bg-gold-500/15 px-4 py-2.5 text-sm font-semibold text-gold-300 transition-colors enabled:hover:bg-gold-500/25 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-white/30"
      >
        {pending ? 'Заправляем…' : label}
      </button>

      <p className="mt-2 text-center text-[11px] text-white/35">{hint}</p>

      {state.error && <p className="mt-2 text-center text-xs text-ember-500">{state.error}</p>}
      {state.success && <p className="mt-2 text-center text-xs text-mint-500">{state.success}</p>}
    </form>
  )
}
