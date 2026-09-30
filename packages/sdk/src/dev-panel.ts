import type { Casino } from './core'
import type { MockControls } from './transports/mock'

export type DevPanelDeps = {
  casino: Casino
  mockControls: MockControls
  /** Передаётся явно, чтобы панель тестировалась без глобального DOM. */
  doc: Document
  sdkVersion: string
}

/**
 * Отладочная панель внутри игры.
 *
 * Задача не «показать красиво», а сделать невозможным состояние, когда игра
 * молча работает на локальном балансе внутри портала. Поэтому при провале
 * хендшейка панель раскрывается сама и висит красным.
 */
export function createDevPanel(deps: DevPanelDeps): () => void {
  const { doc, casino, mockControls } = deps

  const root = doc.createElement('div')
  root.setAttribute('data-casino-devtools', 'true')
  root.style.cssText = [
    'position:fixed',
    'right:12px',
    'bottom:12px',
    'z-index:2147483647',
    'width:280px',
    'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
    'color:#e9e6ff',
    'background:#0b0819',
    'border:1px solid rgba(255,206,92,.35)',
    'border-radius:12px',
    'box-shadow:0 18px 40px -20px rgba(0,0,0,.9)',
    'overflow:hidden',
  ].join(';')

  const header = doc.createElement('div')
  header.style.cssText =
    'display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,206,92,.1);cursor:pointer'

  const badge = doc.createElement('span')
  const title = doc.createElement('span')
  title.textContent = `Casino SDK ${deps.sdkVersion}`
  title.style.cssText = 'flex:1'

  const toggle = doc.createElement('span')
  toggle.textContent = '−'
  toggle.style.cssText = 'opacity:.6'

  header.append(badge, title, toggle)

  const body = doc.createElement('div')
  body.style.cssText = 'padding:10px;display:flex;flex-direction:column;gap:8px'

  const errorBox = doc.createElement('div')
  errorBox.style.cssText =
    'display:none;padding:8px;border-radius:8px;background:rgba(255,77,109,.15);border:1px solid rgba(255,77,109,.5);color:#ff9db0'

  const balanceLine = doc.createElement('div')
  balanceLine.style.cssText = 'font-size:20px;font-weight:700;color:#ffce5c'

  const buttonRow = doc.createElement('div')
  buttonRow.style.cssText = 'display:flex;gap:6px'

  function makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = doc.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.style.cssText =
      'flex:1;padding:5px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:inherit;font:inherit;cursor:pointer'
    button.addEventListener('click', onClick)
    return button
  }

  const logTitle = doc.createElement('div')
  logTitle.textContent = 'последние операции'
  logTitle.style.cssText =
    'opacity:.45;font-size:10px;text-transform:uppercase;letter-spacing:.08em'

  const log = doc.createElement('div')
  log.style.cssText = 'max-height:120px;overflow:auto;white-space:pre-wrap'

  const hint = doc.createElement('div')
  hint.style.cssText =
    'opacity:.45;font-size:10px;border-top:1px solid rgba(255,255,255,.08);padding-top:8px'

  buttonRow.append(
    makeButton('+1000', () => {
      mockControls.deposit(1000)
      render()
    }),
    makeButton('+100', () => {
      mockControls.deposit(100)
      render()
    }),
    makeButton('Сброс', () => {
      mockControls.reset()
      render()
    }),
  )

  body.append(errorBox, balanceLine, buttonRow, logTitle, log, hint)
  root.append(header, body)
  doc.body.append(root)

  let collapsed = false
  header.addEventListener('click', () => {
    collapsed = !collapsed
    body.style.display = collapsed ? 'none' : 'flex'
    toggle.textContent = collapsed ? '+' : '−'
  })

  function render(): void {
    const inPortal = casino.mode === 'portal'

    badge.textContent = inPortal ? 'ПОРТАЛ' : 'МОК'
    badge.style.cssText = [
      'padding:1px 6px',
      'border-radius:999px',
      'font-size:10px',
      'font-weight:700',
      inPortal
        ? 'background:rgba(52,211,153,.2);color:#6ee7b7'
        : 'background:rgba(255,206,92,.2);color:#ffce5c',
    ].join(';')

    balanceLine.textContent = casino.formatBalance()

    const error = casino.handshakeError
    if (error) {
      errorBox.style.display = 'block'
      errorBox.textContent = `Хендшейк не удался (${error.code}): ${error.message}. Игра работает на локальном кошельке.`
      collapsed = false
      body.style.display = 'flex'
      toggle.textContent = '−'
    } else {
      errorBox.style.display = 'none'
    }

    // Начислять деньги можно только локально — в портале кнопки бессмысленны.
    for (const button of Array.from(buttonRow.children)) {
      const element = button as HTMLButtonElement
      element.disabled = inPortal
      element.style.opacity = inPortal ? '0.35' : '1'
      element.style.cursor = inPortal ? 'not-allowed' : 'pointer'
    }

    log.textContent =
      casino.history.length === 0
        ? '—'
        : casino.history
            .slice(0, 6)
            .map(
              (entry) =>
                `${entry.type.padEnd(8)} ${entry.amount >= 0 ? '+' : ''}${entry.amount.toFixed(2)} → ${entry.balance.toFixed(2)}${entry.idempotent ? ' (повтор)' : ''}`,
            )
            .join('\n')

    hint.textContent = inPortal
      ? 'Деньги на сервере портала. Здесь только отладка.'
      : 'Локальный кошелёк в localStorage. Чтобы проверить настоящий, откройте игру в портале.'
  }

  const unsubscribeBalance = casino.on('balance', render)
  const unsubscribeError = casino.on('error', render)

  render()

  return () => {
    unsubscribeBalance()
    unsubscribeError()
    root.remove()
  }
}
