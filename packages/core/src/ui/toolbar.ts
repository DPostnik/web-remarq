import type { StorageStatus, ToolbarPosition } from '../core/types'

const SYNC_LABEL: Record<StorageStatus['state'], string> = {
  synced: 'Saved to the local server',
  queued: 'Saved locally, waiting for the server',
  memory: 'In memory only - lost on reload',
  unauthorized: 'Not paired with the local server',
  rejected: 'Some changes were rejected by the server',
  conflict: 'Some changes collided with newer server copies',
  incompatible: 'Local server too old',
}

export interface ToolbarCallbacks {
  onInspect: () => void
  onCopy: () => void
  onExportMd: () => void
  onExportJson: () => void
  onImport: () => void
  onClear: () => void
  onThemeToggle: () => void
  onSpacingToggle: () => void
  onHelp: () => void
  onBrush?: () => void
  onVerificationBadgeClick?: () => void
  onSubmit?: () => void
  onVoice?: () => void
  onResumeVoice?: () => void
  onCancelVoice?: () => void
  onCopyVoice?: () => void
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '')
const modKey = isMac ? '\u2325' : 'Alt'

const TOOLTIPS: Record<string, string> = {
  inspect: `Inspect element (${modKey}+I)`,
  spacing: 'Spacing overlay (S)',
  copy: 'Copy as Markdown (C)',
  export: 'Export',
  import: 'Import JSON',
  clear: 'Clear all',
  theme: 'Toggle theme',
  help: 'Keyboard shortcuts (?)',
  minimize: 'Minimize',
  submit: 'Submit drafts to agent',
  voice: 'Record voice feedback',
  brush: 'Underline buttons',
  'copy-voice': 'Copy voice feedback',
}

const ICONS = {
  brush: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 2v5a4 4 0 0 0 8 0V2M2 14h12"/></svg>',
  voice: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="6" y="2" width="4" height="8" rx="2"/><path d="M4 8a4 4 0 0 0 8 0M8 12v2"/></svg>',
  stop: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="4" width="8" height="8" rx="1"/></svg>',
  inspect: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4"/><line x1="10" y1="10" x2="14" y2="14"/></svg>',
  spacing: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 2h12M2 14h12M2 2v12M14 2v12"/><path d="M5 5h6v6H5z" stroke-dasharray="2 1"/></svg>',
  copy: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="8" height="9" rx="1"/><path d="M3 11V3a1 1 0 0 1 1-1h6"/></svg>',
  export: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v8M4 6l4-4 4 4M2 12h12"/></svg>',
  import: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 10V2M4 6l4 4 4-4M2 12h12"/></svg>',
  clear: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h10M6 4V3h4v1M5 4v9h6V4"/></svg>',
  theme: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/></svg>',
  help: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M6 6.5a2 2 0 0 1 3.5 1.5c0 1-1.5 1-1.5 2"/><circle cx="8" cy="12" r="0.5" fill="currentColor" stroke="none"/></svg>',
  minimize: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 8h8"/></svg>',
  submit: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2 7 9M14 2 9.5 14 7 9 2 6.5 14 2z"/></svg>',
}

export class Toolbar {
  private toolbarEl: HTMLElement
  private badgeEl: HTMLElement
  private reviewBtn: HTMLButtonElement
  private inspectBtn: HTMLElement
  private brushBtn?: HTMLButtonElement
  private voiceBtn?: HTMLButtonElement
  private copyVoiceBtn?: HTMLButtonElement
  private pausedVoiceEl?: HTMLElement
  private voiceStatus?: HTMLElement
  private spacingBtn: HTMLButtonElement
  private submitBtn: HTMLButtonElement | null = null
  private submitBadgeEl: HTMLElement | null = null
  private exportMenu = document.createElement('div')
  private exportBtn: HTMLButtonElement
  private fileInput: HTMLInputElement
  private syncEl: HTMLElement | null = null
  private simpleEl: HTMLElement | null = null
  private minimized = false
  private buttons: HTMLElement[] = []

  constructor(
    private container: HTMLElement,
    callbacks: ToolbarCallbacks,
    private position: ToolbarPosition = 'bottom-right',
    private simple = false,
  ) {
    this.toolbarEl = document.createElement('div')
    this.toolbarEl.className = `remarq-toolbar remarq-pos-${position}`

    this.inspectBtn = this.createButton('inspect', ICONS.inspect, () => callbacks.onInspect())
    this.badgeEl = document.createElement('span')
    this.badgeEl.className = 'remarq-badge'
    this.badgeEl.title = 'Needs attention'
    this.badgeEl.style.display = 'none'
    this.inspectBtn.appendChild(this.badgeEl)

    this.reviewBtn = this.createButton('review', '', () => callbacks.onVerificationBadgeClick?.())
    this.reviewBtn.type = 'button'
    this.reviewBtn.title = 'Review claimed fixes'
    this.reviewBtn.hidden = true
    this.reviewBtn.setAttribute('aria-expanded', 'false')

    this.spacingBtn = this.createButton('spacing', ICONS.spacing, () => callbacks.onSpacingToggle()) as HTMLButtonElement
    this.spacingBtn.disabled = true

    if (callbacks.onBrush) {
      this.brushBtn = this.createButton('brush', ICONS.brush, callbacks.onBrush)
      this.brushBtn.setAttribute('aria-label', TOOLTIPS.brush)
      this.setBrushActive(false)
    }

    if (callbacks.onVoice && callbacks.onCopyVoice) {
      this.voiceBtn = this.createButton('voice', ICONS.voice, callbacks.onVoice)
      this.copyVoiceBtn = this.exportOption(TOOLTIPS['copy-voice'], callbacks.onCopyVoice)
      this.copyVoiceBtn.setAttribute('data-remarq-action', 'copy-voice')
      this.voiceBtn.setAttribute('aria-label', TOOLTIPS.voice)
      this.copyVoiceBtn.hidden = true
      this.pausedVoiceEl = document.createElement('div')
      this.pausedVoiceEl.className = 'remarq-voice-paused'
      this.pausedVoiceEl.hidden = true
      this.voiceStatus = document.createElement('span')
      this.voiceStatus.setAttribute('role', 'status')
      const resume = this.createButton('resume-voice', 'Resume', () => callbacks.onResumeVoice?.())
      const finish = this.createButton('finish-voice', 'Finish', callbacks.onVoice)
      const cancel = this.createButton('cancel-voice', 'Cancel', () => callbacks.onCancelVoice?.())
      resume.title = 'Resume voice feedback'
      finish.title = 'Finish and save captured voice feedback'
      cancel.title = 'Cancel voice feedback'
      this.pausedVoiceEl.append(this.voiceStatus, resume, finish, cancel)
    }

    if (callbacks.onSubmit) {
      this.submitBtn = this.createButton('submit', ICONS.submit, () => callbacks.onSubmit!()) as HTMLButtonElement
      this.submitBtn.disabled = true
      this.submitBadgeEl = document.createElement('span')
      this.submitBadgeEl.className = 'remarq-badge'
      this.submitBadgeEl.title = 'Drafts to submit'
      this.submitBadgeEl.style.display = 'none'
      this.submitBtn.appendChild(this.submitBadgeEl)
    }

    const copyBtn = this.createButton('copy', ICONS.copy, () => callbacks.onCopy())
    this.exportBtn = this.createButton('export', ICONS.export, () => this.setExportOpen(this.exportMenu.hidden))
    this.exportMenu.className = 'remarq-export-menu'
    if (this.copyVoiceBtn) this.exportMenu.append(this.copyVoiceBtn)
    this.exportMenu.append(
      this.exportOption('MD (file)', callbacks.onExportMd),
      this.exportOption('JSON (file)', callbacks.onExportJson),
    )
    const exportGroup = document.createElement('div')
    exportGroup.style.position = 'relative'
    exportGroup.append(this.exportBtn, this.exportMenu)
    this.setExportOpen(false)

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
    const helpBtn = this.createButton('help', ICONS.help, () => callbacks.onHelp())
    const minimizeBtn = this.createButton('minimize', ICONS.minimize, () => this.toggleMinimize())

    this.buttons = [this.inspectBtn, this.spacingBtn, ...(this.submitBtn ? [this.submitBtn] : []), copyBtn, exportGroup, importBtn, clearBtn, themeBtn, helpBtn]
    if (this.brushBtn) this.buttons.push(this.brushBtn)

    this.toolbarEl.appendChild(this.inspectBtn)
    this.toolbarEl.appendChild(this.reviewBtn)
    this.toolbarEl.appendChild(this.spacingBtn)
    if (this.brushBtn) this.toolbarEl.append(this.brushBtn)
    if (this.voiceBtn) this.toolbarEl.append(this.voiceBtn)
    if (this.pausedVoiceEl) this.toolbarEl.appendChild(this.pausedVoiceEl)
    if (this.submitBtn) this.toolbarEl.appendChild(this.submitBtn)
    this.toolbarEl.appendChild(copyBtn)
    this.toolbarEl.appendChild(exportGroup)
    this.toolbarEl.appendChild(importBtn)
    this.toolbarEl.appendChild(clearBtn)
    this.toolbarEl.appendChild(themeBtn)
    this.toolbarEl.appendChild(helpBtn)
    this.toolbarEl.appendChild(minimizeBtn)
    this.toolbarEl.appendChild(this.fileInput)

    if (simple) {
      this.simpleEl = document.createElement('span')
      this.simpleEl.className = 'remarq-simple-status'
      this.simpleEl.style.display = 'none'
      this.toolbarEl.insertBefore(this.simpleEl, this.inspectBtn)
    }

    container.appendChild(this.toolbarEl)
  }

  setInspectActive(active: boolean): void {
    this.inspectBtn.classList.toggle('remarq-active', active)
  }

  setBrushActive(active: boolean): void {
    this.brushBtn?.classList.toggle('remarq-active', active)
    this.brushBtn?.setAttribute('aria-pressed', String(active))
  }

  setVoiceState(state: 'idle' | 'recording' | 'stopping' | 'paused', hasMessage: boolean, status = ''): void {
    if (!this.voiceBtn || !this.copyVoiceBtn) return
    const active = state !== 'idle'
    this.voiceBtn.classList.toggle('remarq-active', active)
    this.voiceBtn.disabled = state === 'stopping'
    this.voiceBtn.innerHTML = active ? ICONS.stop : ICONS.voice
    this.voiceBtn.title = state === 'recording' ? 'Stop recording and save voice feedback'
      : state === 'paused' ? 'Finish and save captured voice feedback'
      : state === 'stopping' ? 'Finishing voice recognition' : TOOLTIPS.voice
    this.voiceBtn.setAttribute('aria-label', this.voiceBtn.title)
    this.copyVoiceBtn.hidden = !hasMessage
    if (this.pausedVoiceEl && this.voiceStatus) {
      this.pausedVoiceEl.hidden = state !== 'paused'
      this.voiceStatus.textContent = status
    }
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

  setVerificationBadgeCount(count: number): void {
    this.reviewBtn.textContent = `Review ${count}`
    this.reviewBtn.hidden = count === 0
  }

  setReviewOpen(open: boolean): void {
    this.reviewBtn.setAttribute('aria-expanded', String(open))
  }

  get element(): HTMLElement {
    return this.toolbarEl
  }

  focusReview(): void {
    ;(this.reviewBtn.hidden ? this.inspectBtn : this.reviewBtn).focus({ preventScroll: true })
  }

  setSubmitCount(count: number): void {
    if (!this.submitBtn || !this.submitBadgeEl) return
    this.submitBtn.disabled = count === 0
    this.submitBadgeEl.textContent = String(count)
    this.submitBadgeEl.style.display = count > 0 ? 'flex' : 'none'
  }

  /** Simple mode counts acknowledged work and marks waiting for the agent. Hidden at 0. */
  setSimpleStatus(inWork: number, waiting: number): void {
    const el = this.simpleEl
    if (!el) return
    const parts = []
    if (inWork > 0) parts.push(`In work: ${inWork}`)
    if (waiting > 0) parts.push(`Waiting for agent: ${waiting}`)
    el.textContent = parts.join(' | ')
    el.setAttribute('data-state', waiting > 0 ? 'waiting' : 'in-work')
    el.style.display = parts.length ? '' : 'none'
  }

  getFileInput(): HTMLInputElement {
    return this.fileInput
  }

  setMemoryWarning(show: boolean): void {
    this.toolbarEl.title = show ? 'localStorage unavailable — annotations stored in memory only' : ''
  }

  /** Small dot before the first button: where the last write landed (see StorageSyncState). */
  setSyncStatus(status: StorageStatus): void {
    if (!this.syncEl) {
      this.syncEl = document.createElement('span')
      this.syncEl.className = 'remarq-sync'
      this.toolbarEl.insertBefore(this.syncEl, this.toolbarEl.firstChild)
    }
    this.syncEl.setAttribute('data-state', status.state)
    const pending = status.pending > 0 ? ` (${status.pending} pending)` : ''
    this.syncEl.title = `${SYNC_LABEL[status.state]}${pending}${status.message ? `\n${status.message}` : ''}`
    this.syncEl.setAttribute('aria-label', this.syncEl.title)
  }

  destroy(): void {
    this.toolbarEl.remove()
  }

  private createButton(action: string, icon: string, handler: (e: Event) => void): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.className = 'remarq-toolbar-btn'
    btn.setAttribute('data-remarq-action', action)
    btn.title = TOOLTIPS[action] ?? ''
    btn.innerHTML = icon
    btn.addEventListener('click', handler)
    return btn
  }

  private toggleMinimize(): void {
    this.setExportOpen(false)
    this.minimized = !this.minimized
    this.toolbarEl.classList.toggle('remarq-minimized', this.minimized)
    for (const btn of this.buttons) {
      btn.style.display = this.minimized ? 'none' : ''
    }
  }

  private exportOption(label: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.addEventListener('click', () => {
      this.setExportOpen(false)
      this.exportBtn.focus()
      action()
    })
    return button
  }

  private setExportOpen(open: boolean): void {
    this.exportMenu.hidden = !open
    this.exportBtn.setAttribute('aria-expanded', String(open))
  }
}
