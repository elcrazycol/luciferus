'use client'

import { useActionState, useState } from 'react'
import { FormError, FormSuccess } from '@/components/form-field'
import { type ModerationState, moderateAction } from '@/lib/admin-actions'

const INITIAL: ModerationState = {}

/**
 * Решения по одной заявке.
 *
 * Кнопки — это три кнопки одной формы: так решение уходит одним запросом вместе
 * с комментарием, который модератор набрал в поле.
 */
export function ModerationCard({
  slug,
  title,
  children,
}: {
  slug: string
  title: string
  children?: React.ReactNode
}) {
  const [state, action, pending] = useActionState(moderateAction, INITIAL)
  const [noteOpen, setNoteOpen] = useState(false)

  return (
    <div className="glass rounded-2xl bg-ink-900/60 p-5">
      {children}

      <form action={action} className="mt-4 border-t border-white/5 pt-4">
        <input type="hidden" name="slug" value={slug} />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            name="decision"
            value="approve"
            disabled={pending}
            className="rounded-lg border border-mint-500/40 bg-mint-500/15 px-4 py-2 text-sm font-semibold text-mint-500 transition-colors enabled:hover:bg-mint-500/25 disabled:opacity-50"
          >
            Опубликовать
          </button>

          <button
            type="submit"
            name="decision"
            value="reject"
            disabled={pending}
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/70 transition-colors enabled:hover:bg-white/10 disabled:opacity-50"
          >
            Отклонить
          </button>

          <button
            type="submit"
            name="decision"
            value="disable"
            disabled={pending}
            className="rounded-lg border border-ember-500/35 bg-ember-500/10 px-4 py-2 text-sm text-ember-500 transition-colors enabled:hover:bg-ember-500/20 disabled:opacity-50"
          >
            Отключить
          </button>

          <button
            type="button"
            onClick={() => setNoteOpen((open) => !open)}
            className="ml-auto text-xs text-white/40 hover:text-white"
          >
            {noteOpen ? 'Скрыть комментарий' : 'Комментарий автору'}
          </button>
        </div>

        <input
          name="note"
          placeholder="Что не так и что поправить — это увидит автор"
          className={`mt-3 w-full rounded-xl border border-white/10 bg-ink-900/80 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/25 focus:border-gold-500/60 ${
            noteOpen ? 'block' : 'hidden'
          }`}
        />

        <div className="mt-3">
          <FormError message={state.error} />
          <FormSuccess message={state.success} />
        </div>

        <p className="mt-2 text-[11px] text-white/30">
          «Отклонить» вернёт игру в черновики, «Отключить» уберёт из каталога уже{' '}
          {title ? `опубликованную «${title}»` : 'опубликованную игру'}.
        </p>
      </form>
    </div>
  )
}
