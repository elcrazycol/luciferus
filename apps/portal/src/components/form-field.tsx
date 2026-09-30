'use client'

type FormFieldProps = {
  name: string
  label: string
  type?: 'text' | 'password'
  placeholder?: string
  autoComplete?: string
  hint?: string
  defaultValue?: string
  errors?: string[]
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
}: FormFieldProps) {
  const invalid = Boolean(errors?.length)

  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] tracking-wider text-white/45 uppercase">
        {label}
      </span>

      <input
        name={name}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        aria-invalid={invalid}
        aria-describedby={hint ? `${name}-hint` : undefined}
        className={`w-full rounded-xl border bg-ink-900/80 px-3.5 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-gold-500/60 ${
          invalid ? 'border-ember-500/60' : 'border-white/10'
        }`}
      />

      {hint && (
        <span id={`${name}-hint`} className="mt-1 block text-[11px] text-white/30">
          {hint}
        </span>
      )}

      {errors?.map((message) => (
        <span key={message} className="mt-1 block text-[11px] text-ember-500">
          {message}
        </span>
      ))}
    </label>
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
