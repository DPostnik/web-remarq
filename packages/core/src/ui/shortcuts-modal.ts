const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '')
const modKey = isMac ? '\u2325' : 'Alt'  // ⌥ on Mac

const SHORTCUTS = [
  { key: `${modKey}+I`, description: 'Toggle inspect mode' },
  { key: 'S', description: 'Toggle spacing overlay', context: 'inspect' },
  { key: `${modKey}+C`, description: 'Copy all annotations to clipboard' },
  { key: 'Esc', description: 'Exit inspect mode / close popup' },
  { key: '?', description: 'Show this help' },
  { key: 'Enter', description: 'Submit annotation', context: 'popup' },
  { key: 'Shift+Enter', description: 'New line', context: 'popup' },
]

let modalEl: HTMLElement | null = null
let keyHandler: ((e: KeyboardEvent) => void) | null = null

export function showShortcutsModal(container: HTMLElement): void {
  if (modalEl) {
    hideShortcutsModal()
    return
  }

  const backdrop = document.createElement('div')
  backdrop.className = 'remarq-shortcuts-backdrop'

  const modal = document.createElement('div')
  modal.className = 'remarq-shortcuts-modal'

  const title = document.createElement('div')
  title.className = 'remarq-shortcuts-title'
  title.textContent = 'Keyboard Shortcuts'
  modal.appendChild(title)

  for (const s of SHORTCUTS) {
    const row = document.createElement('div')
    row.className = 'remarq-shortcuts-row'

    const key = document.createElement('kbd')
    key.className = 'remarq-shortcuts-key'
    key.textContent = s.key

    const desc = document.createElement('span')
    desc.textContent = s.description

    row.appendChild(key)
    row.appendChild(desc)

    if ('context' in s && s.context) {
      const badge = document.createElement('span')
      badge.className = 'remarq-shortcuts-context'
      badge.textContent = s.context
      row.appendChild(badge)
    }

    modal.appendChild(row)
  }

  backdrop.appendChild(modal)
  container.appendChild(backdrop)
  modalEl = backdrop

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) hideShortcutsModal()
  })

  keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === '?') {
      hideShortcutsModal()
    }
  }
  document.addEventListener('keydown', keyHandler)
}

export function hideShortcutsModal(): void {
  if (modalEl) {
    modalEl.remove()
    modalEl = null
  }
  if (keyHandler) {
    document.removeEventListener('keydown', keyHandler)
    keyHandler = null
  }
}
