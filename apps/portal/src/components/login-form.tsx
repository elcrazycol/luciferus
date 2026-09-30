'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { FormError, FormField } from '@/components/form-field'
import { type AuthFormState, loginAction } from '@/lib/actions'

const INITIAL: AuthFormState = {}

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(loginAction, INITIAL)

  return (
    <>
      <form action={action} className="mt-7 space-y-4">
        {/* Возврат туда, откуда игрока выкинуло. Проверяется на сервере:
            `next=//evil.com` — это внешний редирект, и он не пройдёт. */}
        <input type="hidden" name="next" value={next ?? ''} />

        <FormField
          name="username"
          label="Логин"
          placeholder="player"
          autoComplete="username"
          defaultValue={state.values?.username}
          errors={state.fieldErrors?.username}
        />

        <FormField
          name="password"
          label="Пароль"
          type="password"
          autoComplete="current-password"
          errors={state.fieldErrors?.password}
        />

        <FormError message={state.error} />

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-xl border border-gold-500/40 bg-gold-500/15 px-4 py-2.5 text-sm font-semibold text-gold-300 transition-colors enabled:hover:bg-gold-500/25 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Входим…' : 'Войти'}
        </button>
      </form>

      <p className="mt-6 text-sm text-white/50">
        Нет аккаунта?{' '}
        <Link href="/register" className="text-gold-300 hover:underline">
          Забрать C$250 на старт
        </Link>
      </p>

      <div className="mt-8 rounded-xl border border-white/10 bg-ink-900/60 p-4 text-xs leading-6 text-white/45">
        <p className="text-white/60">Демо-аккаунты из сидов:</p>
        <p>
          <code className="text-gold-300">player</code> /{' '}
          <code className="text-gold-300">player</code> — игрок с C$250
        </p>
        <p>
          <code className="text-gold-300">admin</code> /{' '}
          <code className="text-gold-300">admin</code> — админ
        </p>
      </div>
    </>
  )
}
