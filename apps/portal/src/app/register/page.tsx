import { economy } from '@luciferus/config/economy'
import type { Metadata } from 'next'
import { RegisterForm } from '@/components/register-form'

export const metadata: Metadata = {
  title: 'Регистрация — LuciferusCasinos',
}

export default function RegisterPage() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-14 sm:px-6">
      <h1 className="text-2xl font-bold text-white">
        C${economy.signupBonus} <span className="text-white/40">— просто так</span>
      </h1>
      <p className="mt-1 text-sm text-white/50">
        Аккаунт создаётся сразу, кошелёк получает стартовый бонус. Деньги ненастоящие, но считаются
        честно — каждая операция попадает в журнал.
      </p>

      <RegisterForm />
    </main>
  )
}
