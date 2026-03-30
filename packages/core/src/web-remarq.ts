import type { Annotation, ImportResult, WebRemarqOptions } from './core/types'
import { AnnotationStorage } from './core/storage'
import { createFingerprint } from './core/fingerprint'
import { matchElement } from './core/matcher'
import { generateAgentExport } from './core/agent-export'
import { injectStyles, removeStyles } from './ui/styles'
import { ThemeManager } from './ui/theme'
import { Toolbar } from './ui/toolbar'
import { Overlay } from './ui/overlay'
import { SpacingOverlay } from './ui/spacing-overlay'
import { Popup } from './ui/popup'
import { MarkerManager } from './ui/markers'
import { DetachedPanel } from './ui/detached-panel'
import { RouteObserver } from './spa'
import { toBucket, initViewportListener, destroyViewportListener } from './core/viewport'

let initialized = false
let options: WebRemarqOptions = {}
let storage: AnnotationStorage
let themeManager: ThemeManager
let toolbar: Toolbar
let overlay: Overlay
let popup: Popup
let markers: MarkerManager
let detachedPanel: DetachedPanel
let routeObserver: RouteObserver
let inspecting = false
let spacingMode = false
let spacingOverlay: SpacingOverlay
let mutationObserver: MutationObserver | null = null
let unsubRoute: (() => void) | null = null
let refreshScheduled = false

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

  detachedPanel.update(otherBreakpoint, detached)

  const pendingCount = anns.filter((a) => a.status === 'pending').length
  toolbar.setBadgeCount(pendingCount)
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
      const ann: Annotation = {
        id: generateId(),
        comment,
        fingerprint: fp,
        route: currentRoute(),
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        viewportBucket: toBucket(window.innerWidth),
        timestamp: Date.now(),
        status: 'pending',
      }
      // Cache the element immediately — no need to re-match
      cacheElement(ann.id, target)
      storage.add(ann)
      refreshMarkers()
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
}

function setInspecting(value: boolean): void {
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
  const ann = storage.getAll().find((a) => a.id === annotationId)
  if (!ann) return

  const el = resolveElement(ann)
  if (!el) return

  const rect = el.getBoundingClientRect()

  popup.showDetail(
    {
      tag: ann.fingerprint.tagName,
      text: ann.fingerprint.textContent ?? '',
      comment: ann.comment,
      status: ann.status,
    },
    {
      top: window.scrollY + rect.bottom + 8,
      left: window.scrollX + rect.left,
      anchorBottom: window.scrollY + rect.top - 8,
    },
    {
      onResolve: () => {
        storage.update(ann.id, { status: 'resolved' })
        refreshMarkers()
      },
      onDelete: () => {
        elementCache.delete(ann.id)
        storage.remove(ann.id)
        refreshMarkers()
      },
      onClose: () => {},
    },
  )
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
}

function exportJSON(): void {
  const data = storage.exportJSON()
  const json = JSON.stringify(data, null, 2)
  downloadFile(json, `remarq-annotations-${Date.now()}.json`, 'application/json')
}

function copyToClipboard(): void {
  const md = generateMarkdown()
  if (!md) return
  navigator.clipboard.writeText(md).catch(() => {
    console.warn('[web-remarq] Clipboard write failed')
  })
}

function exportAgent(): void {
  const anns = storage.getAll()
  if (!anns.length) return
  const data = generateAgentExport(anns, toBucket(window.innerWidth))
  const json = JSON.stringify(data, null, 2)
  downloadFile(json, `remarq-agent-${Date.now()}.json`, 'application/json')
}

function copyAgentToClipboard(): void {
  const anns = storage.getAll()
  if (!anns.length) return
  const data = generateAgentExport(anns, toBucket(window.innerWidth))
  const json = JSON.stringify(data, null, 2)
  navigator.clipboard.writeText(json).catch(() => {
    console.warn('[web-remarq] Clipboard write failed')
  })
}

function setupMutationObserver(): void {
  mutationObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.target instanceof HTMLElement && m.target.closest('[data-remarq-theme]')) return
    }
    scheduleRefresh()
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
    options = opts ?? {}

    try {
      injectStyles()
      storage = new AnnotationStorage()
      themeManager = new ThemeManager(document.body, options.theme)
      overlay = new Overlay(themeManager.container)
      spacingOverlay = new SpacingOverlay(themeManager.container)
      popup = new Popup(themeManager.container)
      markers = new MarkerManager(themeManager.container, handleMarkerClick)
      detachedPanel = new DetachedPanel(themeManager.container, (id) => {
        elementCache.delete(id)
        storage.remove(id)
        refreshMarkers()
      })

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
          storage.clearAll()
          refreshMarkers()
        },
        onThemeToggle: () => themeManager.toggle(),
      })

      if (storage.isMemoryOnly) {
        toolbar.setMemoryWarning(true)
      }

      routeObserver = new RouteObserver()
      unsubRoute = routeObserver.onChange(() => refreshMarkers())

      document.addEventListener('click', handleInspectClick, true)
      document.addEventListener('mousemove', handleInspectHover)
      document.addEventListener('keydown', handleInspectKeydown)

      setupMutationObserver()
      initViewportListener(() => refreshMarkers())

      console.debug(`[web-remarq] Initialized on route: ${currentRoute()}`)
      refreshMarkers()
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
      destroyViewportListener()
      unsubRoute?.()
      routeObserver?.destroy()
      markers?.destroy()
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

  async import(file: File): Promise<ImportResult> {
    const text = await file.text()
    const data = JSON.parse(text)
    storage.importJSON(data)
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
    storage?.clearAll()
    if (initialized) refreshMarkers()
  },
}
