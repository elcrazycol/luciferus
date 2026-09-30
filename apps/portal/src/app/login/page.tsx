import type { Metadata } from 'next'
import { LoginForm } from '@/components/login-form'

export const metadata: Metadata = {
  title: 'Вход — LuciferusCasinos',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams

  return (
    <main className="mx-auto w-full max-w-md px-4 py-14 sm:px-6">
      <h1 className="text-2xl font-bold text-white">Вход</h1>
      <p className="mt-1 text-sm text-white/50">
        Логин и пароль. Никакой почты, никаких подтверждений — это песочница.
      </p>

      <LoginForm next={next} />
    </main>
  )
}
