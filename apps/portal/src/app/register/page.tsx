'use client'

import { economy } from '@luciferus/config/economy'
import Link from 'next/link'
import { useActionState } from 'react'
import { FormError, FormField } from '@/components/form-field'
import { type AuthFormState, registerAction } from '@/lib/actions'

const INITIAL: AuthFormState = {}

export default function RegisterPage() {
  const [state, action, pending] = useActionState(registerAction, INITIAL)

  return (
    <main className="mx-auto w-full max-w-md px-4 py-14 sm:px-6">
      <h1 className="text-2xl font-bold text-white">
        C${economy.signupBonus} <span className="text-white/40">— просто так</span>
      </h1>
      <p className="mt-1 text-sm text-white/50">
        Аккаунт создаётся сразу, кошелёк получает стартовый бонус. Деньги ненастоящие, но считаются
        честно — каждая операция попадает в журнал.
      </p>

      <form action={action} className="mt-7 space-y-4">
        <FormField
          name="username"
          label="Логин"
          placeholder="lucky_player"
          autoComplete="username"
          hint="Латиница, цифры и подчёркивание. Он же будет в ссылке на профиль."
          defaultValue={state.values?.username}
          errors={state.fieldErrors?.username}
        />

        <FormField
          name="displayName"
          label="Как вас показывать"
          placeholder="Счастливчик"
          autoComplete="nickname"
          defaultValue={state.values?.displayName}
          errors={state.fieldErrors?.displayName}
        />

        <FormField
          name="password"
          label="Пароль"
          type="password"
          autoComplete="new-password"
          hint="Минимум 8 символов."
          errors={state.fieldErrors?.password}
        />

        <FormError message={state.error} />

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-xl border border-gold-500/40 bg-gold-500/15 px-4 py-2.5 text-sm font-semibold text-gold-300 transition-colors enabled:hover:bg-gold-500/25 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Создаём аккаунт…' : `Создать и получить C$${economy.signupBonus}`}
        </button>
      </form>

      <p className="mt-6 text-sm text-white/50">
        Уже есть аккаунт?{' '}
        <Link href="/login" className="text-gold-300 hover:underline">
          Войти
        </Link>
      </p>

      <p className="mt-8 text-xs leading-6 text-white/35">
        Регистрируясь, вы соглашаетесь с тем, что это демонстрационная площадка: реальных ставок,
        платежей и вывода средств здесь нет.
      </p>
    </main>
  )
}
