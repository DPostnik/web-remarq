import type { Actor, Annotation, ImportResult, QualityCheckInput, StorageAdapter, StorageStatus, WebRemarqOptions } from './core/types'
import { StorageConflictError } from './core/types'
import { AnnotationStorage } from './core/storage'
import { QualityRunner } from './core/quality-runner'
import { LocalStorageAdapter } from './core/local-storage-adapter'
import { HttpStorageAdapter } from './core/http-storage-adapter'
import { validateStore } from './core/validate'
import { createFingerprint } from './core/fingerprint'
import { matchElement } from './core/matcher'
import { generateAgentExport, actionableOnly } from './core/agent-export'
import { transition, type LifecycleAction } from './core/lifecycle'
import { injectStyles, removeStyles } from './ui/styles'
import { ThemeManager } from './ui/theme'
import { Toolbar } from './ui/toolbar'
import { Overlay } from './ui/overlay'
import { SpacingOverlay } from './ui/spacing-overlay'
import { Popup } from './ui/popup'
import { MarkerManager } from './ui/markers'
import { QualityBubbleManager } from './ui/quality-bubble'
import { DetachedPanel } from './ui/detached-panel'
import { showToast, hideToast } from './ui/toast'
import { showShortcutsModal, hideShortcutsModal } from './ui/shortcuts-modal'
import { RouteObserver } from './spa'
import { toBucket, initViewportListener, destroyViewportListener } from './core/viewport'

const IMPORT_BACKUP_KEY = 'remarq:import-backup'

let initialized = false
let options: WebRemarqOptions = {}
let storage: AnnotationStorage
let storageAdapter: StorageAdapter
let lastSyncState: StorageStatus['state'] | null = null
let themeManager: ThemeManager
let toolbar: Toolbar
let overlay: Overlay
let popup: Popup
let markers: MarkerManager
let qualityRunner: QualityRunner
let qualityBubbles: QualityBubbleManager
let detachedPanel: DetachedPanel
let routeObserver: RouteObserver
let inspecting = false
let spacingMode = false
let spacingOverlay: SpacingOverlay
let mutationObserver: MutationObserver | null = null
let unsubRoute: (() => void) | null = null
let refreshScheduled = false
let savedCursor = ''

// WeakRef cache: annotation id → element (survives GC of element)
const elementCache = new Map<string, WeakRef<HTMLElement>>()

function describeTarget(el: HTMLElement): string {
  const parts: string[] = []

  // id
  if (el.id) parts.push(`#${el.id}`)

  // data attributes
  const dataAnnotate = el.getAttribute(options.dataAttribute ?? 'data-annotate')
  const dataTestId = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy')
  if (dataAnnotate) parts.push(`[${dataAnnotate}]`)
  else if (dataTestId) parts.push(`[${dataTestId}]`)

  // Meaningful classes (max 2)
  const classes = Array.from(el.classList)
    .filter((c) => !c.match(/^(sc-|css-)/) && !c.match(/^[a-zA-Z0-9]{8,}$/) && !c.match(/__[a-zA-Z0-9]{3,}$/))
    .slice(0, 2)
  if (classes.length) parts.push(`.${classes.join('.')}`)

  // Direct text only
  let text = ''
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? ''
  }
  text = text.trim()
  if (!text && el.children.length <= 2) text = el.textContent?.trim() ?? ''
  if (text) parts.push(`"${text.slice(0, 30)}"`)

  return parts.join(' ') || ''
}

function currentRoute(): string {
  return location.pathname + location.hash
}

function generateId(): string {
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function qualityInput(ann: Annotation): QualityCheckInput {
  return {
    comment: ann.comment,
    fingerprint: ann.fingerprint,
    route: ann.route,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  }
}

/**
 * Every storage mutation goes through here: the cache was updated optimistically
 * and AnnotationStorage rolls it back on failure, so all that is left to do is
 * tell the user and repaint. No storage rejection is ever left unhandled.
 */
function persist(operation: Promise<unknown>, what: string): void {
  operation.catch((err: unknown) => {
    const detail = err instanceof StorageConflictError
      ? 'it changed elsewhere first - showing the current version'
      : err instanceof Error ? err.message : String(err)
    console.warn(`[web-remarq] ${what} failed:`, err)
    if (themeManager) showToast(themeManager.container, `${what} failed: ${detail}`, 5000)
    if (initialized) refreshMarkers()
  })
}

function handleSyncStatus(status: StorageStatus): void {
  toolbar?.setSyncStatus(status)
  const changed = status.state !== lastSyncState
  lastSyncState = status.state
  if (!changed || status.state === 'synced' || !themeManager) return
  const prefix: Record<StorageStatus['state'], string> = {
    synced: '',
    queued: 'Offline - changes are saved locally',
    memory: 'Warning: localStorage unavailable',
    unauthorized: 'Not paired with the local server',
    rejected: 'The server rejected a change',
    conflict: 'A change collided with a newer version',
    incompatible: 'Local server is too old',
  }
  showToast(themeManager.container, `${prefix[status.state]}${status.message ? `: ${status.message}` : ''}`, 6000)
}

function httpAdapter(): HttpStorageAdapter | null {
  return storageAdapter instanceof HttpStorageAdapter ? storageAdapter : null
}

function cacheElement(annotationId: string, el: HTMLElement): void {
  elementCache.set(annotationId, new WeakRef(el))
}

function getCachedElement(annotationId: string): HTMLElement | null {
  const ref = elementCache.get(annotationId)
  if (!ref) return null
  const el = ref.deref()
  if (!el || !el.isConnected) {
    elementCache.delete(annotationId)
    return null
  }
  return el
}

function resolveElement(ann: Annotation): HTMLElement | null {
  // 1. Check cache first
  const cached = getCachedElement(ann.id)
  if (cached) return cached

  // 2. Fall back to fingerprint matching
  const el = matchElement(ann.fingerprint, { dataAttribute: options.dataAttribute })
  if (el) {
    cacheElement(ann.id, el)
    console.debug(`[web-remarq] Matched "${ann.comment}" via fingerprint on <${el.tagName.toLowerCase()}>`)
  } else {
    console.debug(`[web-remarq] Could not match "${ann.comment}"`, ann.fingerprint)
  }
  return el
}

function refreshMarkers(): void {
  markers.clear()
  const attached: { ann: Annotation; el: HTMLElement }[] = []
  const otherBreakpoint: Annotation[] = []
  const detached: Annotation[] = []
  const route = currentRoute()
  const anns = storage.getByRoute(route)
  const bucket = toBucket(window.innerWidth)  // always read fresh

  for (const ann of anns) {
    const el = resolveElement(ann)
    if (el) {
      attached.push({ ann, el })
    } else if (bucket !== ann.viewportBucket) {
      otherBreakpoint.push(ann)
    } else {
      detached.push(ann)
    }
  }

  for (const { ann, el } of attached) {
    markers.addMarker(ann, el)
  }

  qualityBubbles?.syncVisible(new Set(attached.map(({ ann }) => ann.id)))

  detachedPanel.update(otherBreakpoint, detached)

  const needsAttention = anns.filter(
    (a) => a.status === 'pending' || a.status === 'in_progress',
  ).length
  const needsVerification = anns.filter((a) => a.status === 'fixed_unverified').length
  toolbar.setBadgeCount(needsAttention)
  toolbar.setVerificationBadgeCount(needsVerification)
  if (options.submitFlow) {
    toolbar.setSubmitCount(anns.filter((a) => a.status === 'draft').length)
  }
}

function jumpToFirstUnverified(): void {
  if (!storage || !markers) return
  const ann = storage.getByRoute(currentRoute()).find((a) => a.status === 'fixed_unverified')
  if (!ann) return
  markers.scrollToMarker(ann.id)
}

function submitAllDrafts(): number {
  if (!storage) return 0
  const drafts = storage.getByRoute(currentRoute()).filter((a) => a.status === 'draft')
  for (const ann of drafts) {
    applyTransition(ann.id, 'submit')
  }
  if (drafts.length) {
    showToast(themeManager.container, `Submitted ${drafts.length} annotation${drafts.length === 1 ? '' : 's'}`)
  }
  return drafts.length
}

// Debounced refresh — MutationObserver can fire rapidly
function scheduleRefresh(): void {
  if (refreshScheduled) return
  refreshScheduled = true
  requestAnimationFrame(() => {
    refreshScheduled = false
    refreshMarkers()
  })
}

function handleInspectClick(e: MouseEvent): void {
  if (!inspecting) return

  const target = e.target as HTMLElement
  if (!target || target.closest('[data-remarq-theme]')) return

  e.preventDefault()
  e.stopPropagation()

  setInspecting(false)

  const rect = target.getBoundingClientRect()
  popup.show(
    {
      tag: target.tagName.toLowerCase(),
      text: describeTarget(target),
    },
    {
      top: window.scrollY + rect.bottom + 8,
      left: window.scrollX + rect.left,
      anchorBottom: window.scrollY + rect.top - 8,
    },
    (comment) => {
      const fp = createFingerprint(target, {
        classFilter: options.classFilter,
        dataAttribute: options.dataAttribute,
      })
      const now = Date.now()
      const ann: Annotation = {
        id: generateId(),
        comment,
        fingerprint: fp,
        route: currentRoute(),
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        viewportBucket: toBucket(window.innerWidth),
        timestamp: now,
        status: options.submitFlow ? 'draft' : 'pending',
        lifecycle: [{ type: 'created', actor: 'designer', timestamp: now }],
      }
      // Cache the element immediately — no need to re-match
      cacheElement(ann.id, target)
      persist(storage.add(ann), 'Saving annotation')
      refreshMarkers()
      showToast(themeManager.container, 'Annotation added')
      qualityRunner.run(ann.id, qualityInput(ann))
    },
    () => {
      // cancel
    },
  )
}

function handleInspectHover(e: MouseEvent): void {
  if (!inspecting) return
  const target = e.target as HTMLElement
  if (!target || target.closest('[data-remarq-theme]')) return

  if (spacingMode) {
    overlay.show(target)
    overlay.hideHighlight()
    spacingOverlay.show(target)
  } else {
    overlay.show(target)
  }
  overlay.updateTooltipPosition(e.clientX, e.clientY)
}

function handleInspectKeydown(e: KeyboardEvent): void {
  if (options.shortcuts === false) return
  // Ignore when typing in inputs
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return

  if (e.key === 'Escape' && inspecting) {
    setInspecting(false)
    overlay.hide()
    spacingOverlay.hide()
  }

  if (e.key === 's' && inspecting) {
    spacingMode = !spacingMode
    toolbar.setSpacingActive(spacingMode)
    if (!spacingMode) spacingOverlay.hide()
  }

  if (e.altKey && e.code === 'KeyI') {
    e.preventDefault()
    setInspecting(!inspecting)
    if (!inspecting) {
      overlay.hide()
      spacingOverlay.hide()
    }
  }

  if (e.altKey && e.code === 'KeyC') {
    e.preventDefault()
    copyToClipboard()
  }

  if (e.altKey && e.code === 'KeyD') {
    e.preventDefault()
    elementCache.clear()
    persist(storage.clearAll(), 'Clearing annotations')
    qualityRunner.clear()
    qualityBubbles.clear()
    refreshMarkers()
    showToast(themeManager.container, 'All annotations cleared')
  }

  if (e.key === '?') {
    showShortcutsModal(themeManager.container)
  }
}

function setInspecting(value: boolean): void {
  if (value && !inspecting) {
    savedCursor = document.body.style.cursor
    document.body.style.cursor = 'crosshair'
  }
  if (!value && inspecting) {
    document.body.style.cursor = savedCursor
  }
  inspecting = value
  toolbar.setInspectActive(value)
  toolbar.setSpacingEnabled(value)
  if (!value) {
    overlay.hide()
    spacingOverlay?.hide()
    spacingMode = false
    toolbar.setSpacingActive(false)
  }
}

function handleMarkerClick(annotationId: string): void {
  if (popup.isOpenFor(annotationId)) {
    popup.hide()
    // This toggle path calls hide() directly, bypassing onClose — drop the
    // highlight here or it stays lit with no popup to explain it.
    markers.setSelected(null)
    qualityBubbles.suppress(null)
    return
  }

  const ann = storage.getAll().find((a) => a.id === annotationId)
  if (!ann) return

  const el = resolveElement(ann)
  if (!el) return

  // Anchor to the marker, not the element: on a full-height section the marker
  // sits in the top-right corner while the element's bottom-left is a screen
  // away, which detaches the comment from the marker it belongs to.
  const rect = markers.getMarkerRect(annotationId) ?? el.getBoundingClientRect()

  const detailCallbacks: Parameters<typeof popup.showDetail>[2] = {
    onTransition: (action, reason) => {
      applyTransition(ann.id, action, reason ? { reason } : undefined)
    },
    onDelete: () => {
      markers.setSelected(null)
      qualityRunner.forget(ann.id)
      qualityBubbles.remove(ann.id)
      qualityBubbles.suppress(null)
      elementCache.delete(ann.id)
      persist(storage.remove(ann.id), 'Deleting annotation')
      refreshMarkers()
    },
    onClose: () => {
      markers.setSelected(null)
      qualityBubbles.suppress(null)
    },
    onEdit: (newComment: string) => {
      persist(storage.update(ann.id, { comment: newComment }), 'Saving edit')
      refreshMarkers()
      const fresh = storage.getById(ann.id) ?? ann
      qualityRunner.run(ann.id, { ...qualityInput(fresh), comment: newComment })
    },
    onCopy: () => {
      const fresh = storage.getById(ann.id) ?? ann
      const fp = fresh.fingerprint
      const lines = [
        `[${fresh.status}] "${fresh.comment}"`,
        `Element: <${fp.tagName}>${fp.textContent ? ` "${fp.textContent}"` : ''}`,
        `Route: ${fresh.route}`,
        `Viewport: ${fresh.viewportBucket}px`,
      ]
      if (fp.sourceLocation) lines.push(`Source: ${fp.sourceLocation}`)
      navigator.clipboard.writeText(lines.join('\n')).then(() => {
        showToast(themeManager.container, 'Annotation copied')
      }).catch(() => {
        console.warn('[web-remarq] Clipboard write failed')
      })
    },
  }

  if (qualityRunner.enabled) {
    // Deliberately NOT the onEdit path: the rewrite came out of the checker a
    // moment ago, so its verdict is already fresh — no auto re-check.
    detailCallbacks.onUseRewrite = (rewrite: string) => {
      const fresh = storage.getById(ann.id)
      const qc = fresh?.qualityCheck
      persist(storage.update(ann.id, {
        comment: rewrite,
        ...(qc ? { qualityCheck: { ...qc, refinedBy: 'designer' as const } } : {}),
      }), 'Saving rewrite')
      markers.setSelected(null)
      qualityBubbles.suppress(null)
      refreshMarkers()
    }
    detailCallbacks.onRecheck = () => {
      markers.setSelected(null)
      qualityBubbles.suppress(null)
      const fresh = storage.getById(ann.id) ?? ann
      qualityRunner.run(ann.id, qualityInput(fresh))
    }
  }

  popup.showDetail(
    {
      id: ann.id,
      tag: ann.fingerprint.tagName,
      text: ann.fingerprint.textContent ?? '',
      comment: ann.comment,
      status: ann.status,
      lifecycle: ann.lifecycle,
      qualityCheck: ann.qualityCheck,
      qualityPending: qualityRunner.isPending(ann.id),
    },
    {
      top: window.scrollY + rect.bottom + 8,
      left: window.scrollX + rect.left,
      anchorBottom: window.scrollY + rect.top - 8,
    },
    detailCallbacks,
  )

  markers.setSelected(annotationId)
  qualityBubbles.suppress(annotationId)
}

function generateMarkdown(): string {
  const route = currentRoute()
  const anns = storage.getByRoute(route)
  if (!anns.length) return ''

  const lines = [`## Annotations — ${route} (${anns.length})`, '']

  anns.forEach((ann, i) => {
    const fp = ann.fingerprint

    lines.push(`### ${i + 1}. [${ann.status}] "${ann.comment}"`)

    let elDesc = `Element: <${fp.tagName}>`
    if (fp.textContent) elDesc += ` "${fp.textContent}"`
    lines.push(elDesc)
    lines.push(`Viewport: ${ann.viewportBucket}px`)
    lines.push('')

    if (fp.sourceLocation) {
      lines.push(`Source: \`${fp.sourceLocation}\`${fp.componentName ? ` (${fp.componentName})` : ''}`)
      lines.push('')
    } else if (fp.detectedSource) {
      lines.push(`Source (detected): \`${fp.detectedSource}\`${fp.detectedComponent ? ` (${fp.detectedComponent})` : ''}`)
      lines.push('')
    }

    lines.push('Search hints:')

    if (fp.dataAnnotate) {
      lines.push(`- \`data-annotate="${fp.dataAnnotate}"\` — in template files`)
    }
    if (fp.dataTestId) {
      lines.push(`- \`data-testid="${fp.dataTestId}"\` — in template files`)
    }
    if (fp.id) {
      lines.push(`- \`id="${fp.id}"\` — in template files`)
    }
    if (fp.ariaLabel) {
      lines.push(`- \`aria-label="${fp.ariaLabel}"\` — in template files`)
    }
    if (fp.textContent) {
      lines.push(`- \`"${fp.textContent}"\` — text content in templates`)
    }
    if (fp.cssModules?.length) {
      for (const mod of fp.cssModules) {
        lines.push(`- \`.${mod.localName}\` — in CSS Module file (likely \`${mod.moduleHint}.module.*\`)`)
        lines.push(`- \`styles.${mod.localName}\` — in component JS/TS`)
      }
    }
    if (fp.domPath) {
      lines.push(`- DOM: ${fp.domPath}`)
    }
    const classes = fp.rawClasses ?? fp.stableClasses
    if (classes.length) {
      lines.push(`- Classes: ${classes.join(' ')}`)
    }

    lines.push('')
  })

  return lines.join('\n')
}

function downloadFile(content: string, filename: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function exportMarkdown(): void {
  const md = generateMarkdown()
  if (!md) return
  downloadFile(md, `remarq-annotations-${Date.now()}.md`, 'text/markdown')
  showToast(themeManager.container, 'Exported as Markdown')
}

function exportJSON(): void {
  const data = storage.exportJSON()
  const json = JSON.stringify(data, null, 2)
  downloadFile(json, `remarq-annotations-${Date.now()}.json`, 'application/json')
  showToast(themeManager.container, 'Exported as JSON')
}

function copyToClipboard(): void {
  const md = generateMarkdown()
  if (!md) {
    showToast(themeManager.container, 'No annotations to copy')
    return
  }
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(md).then(() => {
      showToast(themeManager.container, 'Copied to clipboard')
    }).catch(() => {
      fallbackCopy(md)
    })
  } else {
    fallbackCopy(md)
  }
}

function fallbackCopy(text: string): void {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    document.execCommand('copy')
    showToast(themeManager.container, 'Copied to clipboard')
  } catch {
    showToast(themeManager.container, 'Failed to copy')
  }
  textarea.remove()
}

function exportAgent(): void {
  const anns = actionableOnly(storage.getAll())
  if (!anns.length) return
  const data = generateAgentExport(anns, toBucket(window.innerWidth))
  const json = JSON.stringify(data, null, 2)
  downloadFile(json, `remarq-agent-${Date.now()}.json`, 'application/json')
}

function copyAgentToClipboard(): void {
  const anns = actionableOnly(storage.getAll())
  if (!anns.length) return
  const data = generateAgentExport(anns, toBucket(window.innerWidth))
  const json = JSON.stringify(data, null, 2)
  navigator.clipboard.writeText(json).catch(() => {
    console.warn('[web-remarq] Clipboard write failed')
  })
}

interface TransitionOpts {
  actor?: Actor
  actorName?: string
  reason?: string
}

function applyTransition(id: string, action: LifecycleAction, opts: TransitionOpts = {}): void {
  if (!storage) return
  const ann = storage.getById(id)
  if (!ann) return
  const { status, event } = transition(ann, action, opts)
  const lifecycle = [...ann.lifecycle, event]
  persist(storage.update(id, { status, lifecycle }), `Recording "${action}"`)
  markers?.updateStatus(id, status)
  refreshMarkers()
}

function setupMutationObserver(): void {
  mutationObserver = new MutationObserver((mutations) => {
    let hasExternalMutation = false
    for (const m of mutations) {
      if (m.target instanceof HTMLElement && m.target.closest('[data-remarq-theme]')) continue
      hasExternalMutation = true
      break
    }
    if (hasExternalMutation) scheduleRefresh()
  })

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['id', 'class', 'data-annotate', 'data-testid', 'data-test', 'data-cy'],
  })
}

export const WebRemarq = {
  init(opts?: WebRemarqOptions): void {
    if (initialized) return
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', () => WebRemarq.init(opts), { once: true })
      return
    }
    options = opts ?? {}

    try {
      injectStyles()
      storageAdapter = options.storage ?? new LocalStorageAdapter()
      storage = new AnnotationStorage(storageAdapter)
      storage.onChange(() => scheduleRefresh())
      themeManager = new ThemeManager(document.body, options.theme)
      overlay = new Overlay(themeManager.container)
      spacingOverlay = new SpacingOverlay(themeManager.container)
      popup = new Popup(themeManager.container)
      markers = new MarkerManager(themeManager.container, handleMarkerClick, (id, top, left) =>
        qualityBubbles?.updatePosition(id, top, left),
      )
      qualityBubbles = new QualityBubbleManager(themeManager.container, handleMarkerClick)
      qualityRunner = new QualityRunner(options.qualityGate, {
        persist: (id, check) => {
          persist(storage.update(id, { qualityCheck: check }), 'Saving quality check')
        },
        onPending: (id) => qualityBubbles.setPending(id),
        onSettled: (id, check) => qualityBubbles.setVerdict(id, check),
      })
      const position = options.position ?? 'bottom-right'

      detachedPanel = new DetachedPanel(themeManager.container, (id) => {
        elementCache.delete(id)
        qualityRunner.forget(id)
        persist(storage.remove(id), 'Deleting annotation')
        refreshMarkers()
      }, position)

      toolbar = new Toolbar(themeManager.container, {
        onInspect: () => setInspecting(!inspecting),
        onSpacingToggle: () => {
          if (!inspecting) return
          spacingMode = !spacingMode
          toolbar.setSpacingActive(spacingMode)
          if (!spacingMode) spacingOverlay.hide()
        },
        onCopy: copyToClipboard,
        onExportMd: exportMarkdown,
        onExportJson: exportJSON,
        onImport: () => {
          const file = toolbar.getFileInput().files?.[0]
          if (file) {
            WebRemarq.import(file)
          }
        },
        onClear: () => {
          elementCache.clear()
          persist(storage.clearAll(), 'Clearing annotations')
          qualityRunner.clear()
          qualityBubbles.clear()
          refreshMarkers()
          showToast(themeManager.container, 'All annotations cleared')
        },
        onThemeToggle: () => themeManager.toggle(),
        onHelp: () => showShortcutsModal(themeManager.container),
        onVerificationBadgeClick: jumpToFirstUnverified,
        ...(options.submitFlow ? { onSubmit: () => submitAllDrafts() } : {}),
      }, position)

      routeObserver = new RouteObserver()
      unsubRoute = routeObserver.onChange(() => refreshMarkers())

      document.addEventListener('click', handleInspectClick, true)
      document.addEventListener('mousemove', handleInspectHover)
      document.addEventListener('keydown', handleInspectKeydown)

      setupMutationObserver()
      initViewportListener(() => refreshMarkers())

      storage.onStatus(handleSyncStatus)

      storage.ready.then(() => {
        if (storage.isMemoryOnly) {
          toolbar.setMemoryWarning(true)
          showToast(themeManager.container, 'Warning: localStorage unavailable - annotations live in memory only and are lost on reload', 6000)
        }
        refreshMarkers()
      }).catch((err: unknown) => {
        console.error('[web-remarq] Initial load failed:', err)
        showToast(themeManager.container, `Could not load annotations: ${err instanceof Error ? err.message : String(err)}`, 6000)
      })

      console.debug(`[web-remarq] Initialized on route: ${currentRoute()}`)
      initialized = true
    } catch (err) {
      console.error('[web-remarq] Init failed:', err)
    }
  },

  destroy(): void {
    if (!initialized) return
    try {
      document.removeEventListener('click', handleInspectClick, true)
      document.removeEventListener('mousemove', handleInspectHover)
      document.removeEventListener('keydown', handleInspectKeydown)
      mutationObserver?.disconnect()
      mutationObserver = null
      if (inspecting) {
        document.body.style.cursor = savedCursor
      }
      hideToast()
      hideShortcutsModal()
      destroyViewportListener()
      unsubRoute?.()
      routeObserver?.destroy()
      markers?.destroy()
      qualityBubbles?.destroy()
      qualityRunner?.clear()
      storage?.destroy()
      detachedPanel?.destroy()
      popup?.destroy()
      overlay?.destroy()
      spacingOverlay?.destroy()
      toolbar?.destroy()
      themeManager?.destroy()
      removeStyles()
      elementCache.clear()
      inspecting = false
      spacingMode = false
      lastSyncState = null
      initialized = false
    } catch (err) {
      console.error('[web-remarq] Destroy failed:', err)
    }
  },

  setTheme(theme: 'light' | 'dark'): void {
    themeManager?.setTheme(theme)
  },

  export(format: 'md' | 'json' | 'agent'): void {
    if (format === 'md') exportMarkdown()
    else if (format === 'json') exportJSON()
    else exportAgent()
  },

  copy(format?: 'md' | 'agent'): void {
    if (format === 'agent') copyAgentToClipboard()
    else copyToClipboard()
  },

  /**
   * Replace all annotations with the contents of a JSON export. The file is
   * validated BEFORE anything is cleared; the previous store is copied to
   * localStorage (`remarq:import-backup`) so a failure part-way is recoverable.
   */
  async import(file: File): Promise<ImportResult> {
    const text = await file.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      showToast(themeManager.container, 'Import failed: the file is not valid JSON', 5000)
      throw new Error('import: invalid JSON')
    }
    const validated = validateStore(parsed)
    if (!validated.ok) {
      showToast(themeManager.container, `Import failed: ${validated.errors[0]}`, 6000)
      throw new Error(`import: ${validated.errors.join('; ')}`)
    }

    try {
      localStorage.setItem(IMPORT_BACKUP_KEY, JSON.stringify(storage.exportJSON()))
    } catch {
      // no backup possible (quota / disabled) - the import still proceeds, the toast below says so
    }

    try {
      await storage.importJSON(validated.store)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast(themeManager.container, `Import failed part-way: ${message}. Previous annotations restored; a copy is in localStorage["${IMPORT_BACKUP_KEY}"]`, 8000)
      refreshMarkers()
      throw err
    }
    refreshMarkers()

    const allAnns = storage.getAll()
    const bucket = toBucket(window.innerWidth)
    let matched = 0
    let otherBreakpoint = 0
    let detached = 0
    for (const ann of allAnns) {
      if (resolveElement(ann)) {
        matched++
      } else if (bucket !== ann.viewportBucket) {
        otherBreakpoint++
      } else {
        detached++
      }
    }
    return { total: allAnns.length, matched, otherBreakpoint, detached }
  },

  getAnnotations(route?: string): Annotation[] {
    if (!storage) return []
    return route ? storage.getByRoute(route) : storage.getAll()
  },

  clearAll(): void {
    elementCache.clear()
    if (storage) persist(storage.clearAll(), 'Clearing annotations')
    if (initialized) refreshMarkers()
  },

  /** Where the last write landed (see StorageSyncState). Null when the adapter does not report it. */
  getSyncStatus(): StorageStatus | null {
    return httpAdapter()?.getStatus() ?? null
  },

  /** Store the token from `.remarq/config.json` for the local server and reconnect (HttpStorageAdapter only). */
  async pair(token: string): Promise<void> {
    const adapter = httpAdapter()
    if (!adapter) throw new Error('pair() needs an HttpStorageAdapter')
    await adapter.pair(token)
    if (initialized) refreshMarkers()
  },

  /** Send queued changes that were made before any local server was seen (HttpStorageAdapter only). Returns how many were adopted. */
  async adoptUnsent(): Promise<number> {
    const adapter = httpAdapter()
    if (!adapter) return 0
    const n = await adapter.adoptUnsent()
    if (initialized) {
      refreshMarkers()
      showToast(themeManager.container, n ? `Sent ${n} queued change${n === 1 ? '' : 's'}` : 'Nothing to send')
    }
    return n
  },

  /** Download everything that never reached the local server (queues, rejected ops, conflicts) as JSON. */
  exportUnsent(): void {
    const adapter = httpAdapter()
    if (!adapter) return
    downloadFile(JSON.stringify(adapter.exportUnsent(), null, 2), `remarq-unsent-${Date.now()}.json`, 'application/json')
  },

  acknowledge(id: string, opts?: TransitionOpts): void {
    applyTransition(id, 'acknowledge', opts)
  },

  claimFix(id: string, opts?: TransitionOpts): void {
    applyTransition(id, 'claimFix', opts)
  },

  verify(id: string, opts?: TransitionOpts): void {
    applyTransition(id, 'verify', opts)
  },

  reject(id: string, opts?: TransitionOpts): void {
    applyTransition(id, 'reject', opts)
  },

  dismiss(id: string, opts?: TransitionOpts): void {
    applyTransition(id, 'dismiss', opts)
  },

  reopen(id: string, opts?: TransitionOpts): void {
    applyTransition(id, 'reopen', opts)
  },

  /** Submit all draft annotations of the current route (draft → pending). Returns the count. */
  submitDrafts(): number {
    return submitAllDrafts()
  },

  /** @deprecated Use verify() instead. */
  markResolved(id: string): void {
    applyTransition(id, 'verify')
  },
}
