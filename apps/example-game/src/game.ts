import type { Casino } from '@luciferus/sdk'
import { DECLARED_RTP, evaluateMultiplier, PAYTABLE_DISPLAY, SYMBOLS, spin } from './slot'

/**
 * Эталонная игра: трёхбарабанный слот, подключённый к порталу через SDK.
 *
 * Здесь показано ровно то, что должен делать автор игры, и ничего лишнего:
 * дождаться SDK, показать баланс, провести раунд из ставки и выплаты и не
 * потерять деньги, если что-то сорвалось в середине.
 */

const CANDIDATE_BETS = [1, 5, 10, 25]

const elements = {
  reels: document.querySelectorAll<HTMLElement>('.reel'),
  result: required<HTMLElement>('#result'),
  balance: required<HTMLElement>('#balance'),
  mode: required<HTMLElement>('#mode'),
  spin: required<HTMLButtonElement>('#spin'),
  bets: required<HTMLElement>('#bets'),
  paytable: required<HTMLElement>('#paytable'),
  rtp: required<HTMLElement>('#rtp'),
}

function required<Element extends HTMLElement>(selector: string): Element {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`В разметке нет элемента ${selector}`)
  return element as Element
}

/**
 * Скрипт SDK подключён с `async`, поэтому к моменту запуска этого модуля
 * `window.Casinos` может ещё не существовать. Ждём его появления.
 */
async function waitForCasino(timeoutMs = 10_000): Promise<Casino> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (window.Casinos) return window.Casinos
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  throw new Error('SDK не загрузился: window.Casinos не появился за 10 секунд')
}

function renderReels(symbols: readonly string[]): void {
  elements.reels.forEach((reel, index) => {
    reel.textContent = symbols[index] ?? '·'
  })
}

function glyphOf(id: string): string {
  return SYMBOLS.find((symbol) => symbol.id === id)?.glyph ?? '·'
}

function setResult(text: string, kind: 'win' | 'loss' | 'info' | 'error'): void {
  elements.result.textContent = text
  elements.result.dataset.kind = kind
}

async function main(): Promise<void> {
  elements.rtp.textContent = `${(DECLARED_RTP * 100).toFixed(1)}%`

  elements.paytable.innerHTML = PAYTABLE_DISPLAY.map(
    (row) => `<span class="pay"><b>${row.glyphs}</b><i>×${row.multiplier}</i></span>`,
  ).join('')

  const casino = await waitForCasino()

  // Ждём завершения хендшейка: до этого баланс ещё нулевой.
  const session = await casino.ready()

  elements.mode.textContent = casino.isInsidePortal ? 'в портале' : 'мок-режим · локальный кошелёк'
  elements.mode.dataset.mode = casino.mode

  if (casino.handshakeError) {
    elements.mode.textContent = `хендшейк не удался · ${casino.handshakeError.code}`
    elements.mode.dataset.mode = 'broken'
  }

  function renderBalance(): void {
    elements.balance.textContent = casino.formatBalance()
  }

  casino.on('balance', renderBalance)
  renderBalance()

  if (session.player) {
    document.documentElement.dataset.player = session.player.displayName
  }

  // Ставки, которые вообще имеет смысл предлагать: в пределах лимитов этой игры.
  const bets = CANDIDATE_BETS.filter(
    (value) => value >= casino.limits.minBet && value <= casino.limits.maxBet,
  )
  let currentBet = bets[0] ?? casino.limits.minBet

  elements.bets.innerHTML = ''
  for (const value of bets) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'bet'
    button.textContent = casino.formatBalance(value)
    button.dataset.active = String(value === currentBet)

    button.addEventListener('click', () => {
      currentBet = value
      for (const sibling of elements.bets.querySelectorAll('button')) {
        sibling.dataset.active = String(sibling === button)
      }
    })

    elements.bets.append(button)
  }

  let busy = false

  async function play(): Promise<void> {
    if (busy) return
    busy = true
    elements.spin.disabled = true
    setResult('Крутим…', 'info')

    const roundId = casino.roundId()
    let betPlaced = false
    let payoutDone = false

    try {
      // 1. Ставка. Пока она не прошла, крутить нельзя — иначе выигрыш
      //    считался бы из воздуха.
      await casino.bet(currentBet, { roundId, meta: { game: 'lucky-7s' } })
      betPlaced = true

      // 2. Исход. Здесь его считает клиент: игра объявлена как `fairMode: "client"`.
      const outcome = spin()
      await animate(elements.reels, outcome)

      const multiplier = evaluateMultiplier(outcome)
      renderReels(outcome.map(glyphOf))

      // 3. Выплата. Повтор с тем же roundId не удвоит выигрыш.
      if (multiplier > 0) {
        const win = Math.round(currentBet * multiplier * 100) / 100
        await casino.payout(win, { roundId, meta: { multiplier } })
        payoutDone = true

        setResult(`Выигрыш ${casino.formatBalance(win)}  (×${multiplier})`, 'win')
      } else {
        setResult(`Мимо. Ставка ${casino.formatBalance(currentBet)}`, 'loss')
      }
    } catch (error) {
      // Если ставка прошла, а выплата нет — деньги нельзя оставлять себе.
      // Сервер откажет в отмене, если выплата всё-таки успела пройти.
      if (betPlaced && !payoutDone) {
        try {
          await casino.rollback({ roundId, meta: { reason: 'ошибка в игре' } })
          setResult('Раунд отменён, ставка возвращена', 'info')
        } catch {
          setResult('Не удалось вернуть ставку — проверьте историю кошелька', 'error')
        }
      } else {
        setResult(error instanceof Error ? error.message : 'Что-то пошло не так', 'error')
      }
    } finally {
      busy = false
      elements.spin.disabled = false
      renderBalance()
    }
  }

  elements.spin.addEventListener('click', () => void play())

  renderReels(['cherry', 'bell', 'gem'].map(glyphOf))
  setResult('Ставьте и крутите', 'info')

  // Пробел крутит — как в настоящем слоте.
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !busy) {
      event.preventDefault()
      void play()
    }
  })
}

/** Прокрутка барабанов: чисто визуальная, исход уже известен. */
async function animate(reels: NodeListOf<HTMLElement>, outcome: string[]): Promise<void> {
  const frames = 12

  for (let frame = 0; frame < frames; frame += 1) {
    reels.forEach((reel, index) => {
      const settled = frame > frames - 4 - index * 2
      reel.textContent = settled
        ? glyphOf(outcome[index] ?? 'cherry')
        : glyphOf(SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]?.id ?? 'cherry')
    })

    await new Promise((resolve) => setTimeout(resolve, 45))
  }

  reels.forEach((reel, index) => {
    reel.textContent = glyphOf(outcome[index] ?? 'cherry')
  })
}

void main().catch((error: unknown) => {
  setResult(error instanceof Error ? error.message : 'Игра не смогла запуститься', 'error')
})
