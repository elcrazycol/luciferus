'use client'

import type { FieldErrors } from '@luciferus/protocol/errors'
import type { ReactNode } from 'react'

/**
 * Примитивы форм.
 *
 * Все — обычные HTML-контролы с `name`, чтобы работали и без JavaScript:
 * форма должна отправляться, даже если гидрация не случилась.
 */

const inputClass =
  'w-full rounded-xl border bg-ink-900/80 px-3.5 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-gold-500/60'

function Label({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1.5 block text-[11px] tracking-wider text-white/45 uppercase">
      {children}
    </span>
  )
}

function ErrorList({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null

  return (
    <>
      {errors.map((message) => (
        <span key={message} className="mt-1 block text-[11px] text-ember-500">
          {message}
        </span>
      ))}
    </>
  )
}

export function FormField({
  name,
  label,
  type = 'text',
  placeholder,
  autoComplete,
  hint,
  defaultValue,
  errors,
}: {
  name: string
  label: string
  type?: 'text' | 'password'
  placeholder?: string
  autoComplete?: string
  hint?: string
  defaultValue?: string
  errors?: string[]
}) {
  const invalid = Boolean(errors?.length)

  return (
    <label className="block">
      <Label>{label}</Label>

      <input
        name={name}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        aria-invalid={invalid}
        className={`${inputClass} ${invalid ? 'border-ember-500/60' : 'border-white/10'}`}
      />

      {hint && <span className="mt-1 block text-[11px] text-white/30">{hint}</span>}
      <ErrorList errors={errors} />
    </label>
  )
}

export function TextAreaField({
  name,
  label,
  hint,
  placeholder,
  rows = 3,
  defaultValue,
  errors,
}: {
  name: string
  label: string
  hint?: string
  placeholder?: string
  rows?: number
  defaultValue?: string
  errors?: string[]
}) {
  const invalid = Boolean(errors?.length)

  return (
    <label className="block">
      <Label>{label}</Label>

      <textarea
        name={name}
        rows={rows}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className={`${inputClass} font-mono ${invalid ? 'border-ember-500/60' : 'border-white/10'}`}
      />

      {hint && <span className="mt-1 block text-[11px] text-white/30">{hint}</span>}
      <ErrorList errors={errors} />
    </label>
  )
}

export function SelectField({
  name,
  label,
  options,
  defaultValue,
  hint,
  errors,
}: {
  name: string
  label: string
  options: Array<{ value: string; label: string }>
  defaultValue?: string
  hint?: string
  errors?: string[]
}) {
  return (
    <label className="block">
      <Label>{label}</Label>

      <select name={name} defaultValue={defaultValue} className={`${inputClass} border-white/10`}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {hint && <span className="mt-1 block text-[11px] text-white/30">{hint}</span>}
      <ErrorList errors={errors} />
    </label>
  )
}

export function CheckboxGroup({
  name,
  label,
  options,
  defaultChecked,
  hint,
  errors,
}: {
  name: string
  label: string
  options: Array<{ value: string; label: string }>
  defaultChecked?: string[]
  hint?: string
  errors?: string[]
}) {
  return (
    <fieldset>
      <Label>{label}</Label>

      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-sm text-white/70">
            <input
              type="checkbox"
              name={name}
              value={option.value}
              defaultChecked={defaultChecked?.includes(option.value)}
              className="h-4 w-4 rounded border-white/20 bg-ink-900 accent-gold-500"
            />
            {option.label}
          </label>
        ))}
      </div>

      {hint && <span className="mt-1 block text-[11px] text-white/30">{hint}</span>}
      <ErrorList errors={errors} />
    </fieldset>
  )
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null

  return (
    <p className="rounded-xl border border-ember-500/30 bg-ember-500/10 px-4 py-2.5 text-sm text-ember-500">
      {message}
    </p>
  )
}

export function FormSuccess({ message }: { message?: string }) {
  if (!message) return null

  return (
    <p className="rounded-xl border border-mint-500/30 bg-mint-500/10 px-4 py-2.5 text-sm text-mint-500">
      {message}
    </p>
  )
}

export type { FieldErrors }
