/**
 * Toast minimalista — DOM-based pra evitar provider boilerplate por enquanto.
 * Quando precisarmos de variantes/queue grande, trocar por sonner ou similar.
 */

type Tone = 'success' | 'danger' | 'info' | 'warning'

const containerId = 'bh-toast-container'

function ensureContainer(): HTMLElement {
  let el = document.getElementById(containerId)
  if (!el) {
    el = document.createElement('div')
    el.id = containerId
    el.style.cssText = `
      position: fixed; bottom: 1rem; right: 1rem; z-index: 200;
      display: flex; flex-direction: column; gap: 0.5rem;
      pointer-events: none;
    `
    document.body.appendChild(el)
  }
  return el
}

const toneColors: Record<Tone, { bg: string; fg: string; border: string }> = {
  success: { bg: 'oklch(0.32 0.04 247)', fg: 'oklch(0.72 0.17 152)', border: 'oklch(0.72 0.17 152 / 0.4)' },
  danger:  { bg: 'oklch(0.32 0.04 247)', fg: 'oklch(0.72 0.17 25)',  border: 'oklch(0.66 0.22 25 / 0.4)' },
  info:    { bg: 'oklch(0.32 0.04 247)', fg: 'oklch(0.95 0.013 247)', border: 'oklch(0.28 0.025 247 / 0.7)' },
  warning: { bg: 'oklch(0.32 0.04 247)', fg: 'oklch(0.78 0.17 75)',  border: 'oklch(0.78 0.17 75 / 0.4)' },
}

export function toast(message: string, tone: Tone = 'info', durationMs = 3500) {
  const container = ensureContainer()
  const item = document.createElement('div')
  const c = toneColors[tone]
  item.style.cssText = `
    background: ${c.bg}; color: ${c.fg};
    border: 1px solid ${c.border}; border-radius: 0.5rem;
    padding: 0.625rem 0.875rem; font-size: 0.8125rem;
    box-shadow: 0 12px 24px -8px oklch(0 0 0 / 0.45);
    pointer-events: auto; max-width: 22rem;
    animation: bh-toast-in 200ms cubic-bezier(0.16, 1, 0.3, 1);
  `
  item.textContent = message
  container.appendChild(item)
  setTimeout(() => {
    item.style.transition = 'opacity 200ms, transform 200ms'
    item.style.opacity = '0'
    item.style.transform = 'translateX(1rem)'
    setTimeout(() => item.remove(), 220)
  }, durationMs)
}

if (typeof document !== 'undefined' && !document.getElementById('bh-toast-styles')) {
  const style = document.createElement('style')
  style.id = 'bh-toast-styles'
  style.textContent = `@keyframes bh-toast-in { from { opacity: 0; transform: translateX(1rem); } to { opacity: 1; transform: translateX(0); } }`
  document.head.appendChild(style)
}
