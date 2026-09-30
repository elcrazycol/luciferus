'use client'

import { economy } from '@luciferus/config/economy'
import {
  GAME_CATEGORIES,
  GAME_CATEGORY_LABELS,
  GAME_VOLATILITIES,
  GAME_VOLATILITY_LABELS,
} from '@luciferus/protocol/game'
import { useActionState } from 'react'
import {
  CheckboxGroup,
  FormError,
  FormField,
  SelectField,
  TextAreaField,
} from '@/components/form-field'
import { type SubmitFormState, submitGameAction } from '@/lib/game-actions'

const INITIAL: SubmitFormState = {}

const CATEGORY_OPTIONS = GAME_CATEGORIES.map((value) => ({
  value,
  label: GAME_CATEGORY_LABELS[value],
}))

const VOLATILITY_OPTIONS = [
  { value: '', label: 'не указана' },
  ...GAME_VOLATILITIES.map((value) => ({ value, label: GAME_VOLATILITY_LABELS[value] })),
]

export function SubmitGameForm() {
  const [state, action, pending] = useActionState(submitGameAction, INITIAL)
  const values = state.values ?? {}

  return (
    <form action={action} className="space-y-4">
      <FormField
        name="slug"
        label="Слаг"
        placeholder="my-lucky-slot"
        hint="Латиница, цифры и дефис. Попадёт в адрес игры: /game/my-lucky-slot"
        defaultValue={values.slug}
        errors={state.fieldErrors?.slug}
      />

      <FormField
        name="title"
        label="Название"
        placeholder="My Lucky Slot"
        defaultValue={values.title}
        errors={state.fieldErrors?.title}
      />

      <TextAreaField
        name="description"
        label="Описание"
        placeholder="Три барабана, семь символов и очень щедрый джекпот."
        rows={2}
        defaultValue={values.description}
        errors={state.fieldErrors?.description}
      />

      <FormField
        name="embedUrl"
        label="Адрес игры"
        placeholder="https://my-game.example/play"
        hint="Страница, которую портал загрузит в iframe. Хостится у вас."
        defaultValue={values.embedUrl}
        errors={state.fieldErrors?.embedUrl}
      />

      <TextAreaField
        name="origins"
        label="Origin`ы игры"
        placeholder="https://my-game.example"
        hint="По одному на строку. Origin — схема, хост и порт, без пути. Именно туда портал отправит приветствие."
        defaultValue={values.origins}
        errors={state.fieldErrors?.origins}
      />

      <CheckboxGroup
        name="categories"
        label="Категории"
        options={CATEGORY_OPTIONS}
        hint="До четырёх. Влияют только на фильтры каталога."
        errors={state.fieldErrors?.categories}
      />

      <FormField
        name="tags"
        label="Теги"
        placeholder="7s, classic, 3-reels"
        hint="Через запятую, до восьми."
        defaultValue={values.tags}
        errors={state.fieldErrors?.tags}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField
          name="fairMode"
          label="Режим честности"
          defaultValue={values.fairMode ?? 'client'}
          options={[
            { value: 'client', label: 'Клиентский — исход считает игра' },
            { value: 'provably-fair', label: 'Проверяемый — сиды раскрываются' },
          ]}
          hint="Проверяемый режим появится в фазе 4."
          errors={state.fieldErrors?.fairMode}
        />

        <SelectField
          name="volatility"
          label="Волатильность"
          defaultValue={values.volatility ?? ''}
          options={VOLATILITY_OPTIONS}
          errors={state.fieldErrors?.volatility}
        />
      </div>

      <fieldset className="rounded-xl border border-white/10 p-4">
        <legend className="px-2 text-[11px] tracking-wider text-white/45 uppercase">Лимиты</legend>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField
            name="minBet"
            label="Мин. ставка"
            placeholder="1"
            defaultValue={values.minBet ?? '1'}
            errors={state.fieldErrors?.['limits.minBet']}
          />
          <FormField
            name="maxBet"
            label="Макс. ставка"
            placeholder="50"
            defaultValue={values.maxBet ?? '50'}
            errors={state.fieldErrors?.['limits.maxBet']}
          />
          <FormField
            name="maxWin"
            label="Макс. выигрыш"
            placeholder="2000"
            defaultValue={values.maxWin ?? '2000'}
            errors={state.fieldErrors?.['limits.maxWin']}
          />
        </div>

        <p className="mt-3 text-[11px] text-white/30">
          Лимиты проверяет сервер: ставку вне их диапазона он отклонит, что бы ни присылала игра.
        </p>
      </fieldset>

      <FormField
        name="thumbnailUrl"
        label="Превью (необязательно)"
        placeholder="https://my-game.example/thumb.png"
        hint="Пока каталог рисует градиентную заглушку с первой буквой названия."
        defaultValue={values.thumbnailUrl}
        errors={state.fieldErrors?.thumbnailUrl}
      />

      <FormError message={state.error} />

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl border border-gold-500/40 bg-gold-500/15 px-4 py-2.5 text-sm font-semibold text-gold-300 transition-colors enabled:hover:bg-gold-500/25 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Отправляем…' : 'Отправить на модерацию'}
      </button>

      <p className="text-center text-[11px] text-white/30">
        Модерация проверяет, что игра открывается и объявленный origin совпадает с адресом.
        Стартовый бонус игрокам — C${economy.signupBonus}, платить за рассмотрение не нужно.
      </p>
    </form>
  )
}
