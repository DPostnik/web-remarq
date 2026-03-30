export interface ToolbarCallbacks {
  onInspect: () => void
  onCopy: () => void
  onExportMd: () => void
  onExportJson: () => void
  onImport: () => void
  onClear: () => void
  onThemeToggle: () => void
  onSpacingToggle: () => void
}

const TOOLTIPS: Record<string, string> = {
  inspect: 'Inspect element',
  spacing: 'Spacing overlay (S)',
  copy: 'Copy as Markdown',
  export: 'Export',
  import: 'Import JSON',
  clear: 'Clear all',
  theme: 'Toggle theme',
  minimize: 'Minimize',
}

const ICONS = {
  inspect: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4"/><line x1="10" y1="10" x2="14" y2="14"/></svg>',
  spacing: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 2h12M2 14h12M2 2v12M14 2v12"/><path d="M5 5h6v6H5z" stroke-dasharray="2 1"/></svg>',
  copy: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="8" height="9" rx="1"/><path d="M3 11V3a1 1 0 0 1 1-1h6"/></svg>',
  export: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v8M4 6l4-4 4 4M2 12h12"/></svg>',
  import: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 10V2M4 6l4 4 4-4M2 12h12"/></svg>',
  clear: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h10M6 4V3h4v1M5 4v9h6V4"/></svg>',
  theme: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/></svg>',
  minimize: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 8h8"/></svg>',
}

export class Toolbar {
  private toolbarEl: HTMLElement
  private badgeEl: HTMLElement
  private inspectBtn: HTMLElement
  private spacingBtn: HTMLButtonElement
  private exportMenu: HTMLElement | null = null
  private fileInput: HTMLInputElement
  private minimized = false
  private buttons: HTMLElement[] = []

  constructor(
    private container: HTMLElement,
    private callbacks: ToolbarCallbacks,
  ) {
    this.toolbarEl = document.createElement('div')
    this.toolbarEl.className = 'remarq-toolbar'

    this.inspectBtn = this.createButton('inspect', ICONS.inspect, () => callbacks.onInspect())
    this.badgeEl = document.createElement('span')
    this.badgeEl.className = 'remarq-badge'
    this.badgeEl.style.display = 'none'
    this.inspectBtn.appendChild(this.badgeEl)

    this.spacingBtn = this.createButton('spacing', ICONS.spacing, () => callbacks.onSpacingToggle()) as HTMLButtonElement
    this.spacingBtn.disabled = true

    const copyBtn = this.createButton('copy', ICONS.copy, () => callbacks.onCopy())
    const exportBtn = this.createButton('export', ICONS.export, (e) => this.toggleExportMenu(e))

    this.fileInput = document.createElement('input')
    this.fileInput.type = 'file'
    this.fileInput.accept = '.json'
    this.fileInput.style.display = 'none'
    this.fileInput.addEventListener('change', () => {
      callbacks.onImport()
      this.fileInput.value = ''
    })
    const importBtn = this.createButton('import', ICONS.import, () => this.fileInput.click())

    const clearBtn = this.createButton('clear', ICONS.clear, () => callbacks.onClear())
    const themeBtn = this.createButton('theme', ICONS.theme, () => callbacks.onThemeToggle())
    const minimizeBtn = this.createButton('minimize', ICONS.minimize, () => this.toggleMinimize())

    this.buttons = [this.inspectBtn, this.spacingBtn, copyBtn, exportBtn, importBtn, clearBtn, themeBtn]

    this.toolbarEl.appendChild(this.inspectBtn)
    this.toolbarEl.appendChild(this.spacingBtn)
    this.toolbarEl.appendChild(copyBtn)
    this.toolbarEl.appendChild(exportBtn)
    this.toolbarEl.appendChild(importBtn)
    this.toolbarEl.appendChild(clearBtn)
    this.toolbarEl.appendChild(themeBtn)
    this.toolbarEl.appendChild(minimizeBtn)
    this.toolbarEl.appendChild(this.fileInput)

    container.appendChild(this.toolbarEl)
  }

  setInspectActive(active: boolean): void {
    this.inspectBtn.classList.toggle('remarq-active', active)
  }

  setSpacingActive(active: boolean): void {
    this.spacingBtn.classList.toggle('remarq-active', active)
  }

  setSpacingEnabled(enabled: boolean): void {
    this.spacingBtn.disabled = !enabled
    if (!enabled) {
      this.spacingBtn.classList.remove('remarq-active')
    }
  }

  setBadgeCount(count: number): void {
    this.badgeEl.textContent = String(count)
    this.badgeEl.style.display = count > 0 ? 'flex' : 'none'
  }

  getFileInput(): HTMLInputElement {
    return this.fileInput
  }

  setMemoryWarning(show: boolean): void {
    this.toolbarEl.title = show ? 'localStorage unavailable — annotations stored in memory only' : ''
  }

  destroy(): void {
    this.closeExportMenu()
    this.toolbarEl.remove()
  }

  private createButton(action: string, icon: string, handler: (e: Event) => void): HTMLElement {
    const btn = document.createElement('button')
    btn.className = 'remarq-toolbar-btn'
    btn.setAttribute('data-remarq-action', action)
    btn.title = TOOLTIPS[action] ?? ''
    btn.innerHTML = icon
    btn.addEventListener('click', handler)
    return btn
  }

  private toggleMinimize(): void {
    this.minimized = !this.minimized
    this.toolbarEl.classList.toggle('remarq-minimized', this.minimized)
    for (const btn of this.buttons) {
      btn.style.display = this.minimized ? 'none' : ''
    }
  }

  private toggleExportMenu(e: Event): void {
    if (this.exportMenu) {
      this.closeExportMenu()
      return
    }

    this.exportMenu = document.createElement('div')
    this.exportMenu.className = 'remarq-export-menu'

    const mdBtn = document.createElement('button')
    mdBtn.textContent = 'MD (file)'
    mdBtn.addEventListener('click', () => {
      this.callbacks.onExportMd()
      this.closeExportMenu()
    })

    const jsonBtn = document.createElement('button')
    jsonBtn.textContent = 'JSON (file)'
    jsonBtn.addEventListener('click', () => {
      this.callbacks.onExportJson()
      this.closeExportMenu()
    })

    this.exportMenu.appendChild(mdBtn)
    this.exportMenu.appendChild(jsonBtn)

    const exportBtn = (e.currentTarget as HTMLElement)
    exportBtn.style.position = 'relative'
    exportBtn.appendChild(this.exportMenu)
  }

  private closeExportMenu(): void {
    if (this.exportMenu) {
      this.exportMenu.remove()
      this.exportMenu = null
    }
  }
}
