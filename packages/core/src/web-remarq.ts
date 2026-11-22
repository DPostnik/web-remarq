import type { Actor, Annotation, ImportResult, QualityCheckInput, StorageAdapter, StorageStatus, WebRemarqOptions } from './core/types'
import { StorageConflictError } from './core/types'
import { AnnotationStorage } from './core/storage'
import { QualityRunner } from './core/quality-runner'
import { LocalStorageAdapter } from './core/local-storage-adapter'
import { HttpStorageAdapter } from './core/http-storage-adapter'
import { LIMITS, validateAnnotation, validateStore } from './core/validate'
import { WebSpeechAdapter, type SpeechAdapter, type SpeechSession } from './core/speech'
import { checkedVoiceTargets, formatVoiceMessage, reviewClaim, reviewTargets, voiceTranscript, type ReviewTarget, type VoiceMark } from './core/voice-message'
import { buildDomPath, createFingerprint, FINGERPRINT_TEXT_LIMIT, getTextContent } from './core/fingerprint'
import { matchElement } from './core/matcher'
import { formatAgentTargets, generateAgentExport, actionableOnly } from './core/agent-export'
import { transition, type LifecycleAction } from './core/lifecycle'
import { injectStyles, removeStyles } from './ui/styles'
import { ThemeManager } from './ui/theme'
import { Toolbar } from './ui/toolbar'
import { ReviewPanel, type ReviewItem } from './ui/review'
import { Overlay } from './ui/overlay'
import { Underline } from './ui/underline'
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
let reviewPanel: ReviewPanel
let activeReview: string | null = null
const savingReview = new Map<string, Annotation>()
const reviewMarkers = new Set<string>()
let overlay: Overlay
let brush: Underline
let brushing = false
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
let speech: SpeechAdapter | undefined
interface Recording {
  session?: SpeechSession
  timer?: ReturnType<typeof setTimeout>
  attemptsWithoutSpeech: number
  startedAt: number
  transcript: string
  stopping: boolean
  anchor: Annotation
  marks: VoiceMark[]
  markers: MarkerManager
}
const SPEECH_RETRY_DELAYS = [250, 1000, 2000]
const SPEECH_STOP_TIMEOUT = 3000
let recording: Recording | undefined
let voiceMessage = ''
// Simple mode: ids whose first save has not resolved yet (kept visible), and the last seen status per id (to detect agent claims).
const unconfirmed = new Set<string>()
let statusSnapshot: Map<string, Annotation['status']> | null = null

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
  // Queued writes leaving the outbox change which marks the backend has.
  if (options.simple && initialized) scheduleRefresh()
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

const IN_WORK = (a: Annotation): boolean => a.status === 'pending' || a.status === 'in_progress'

/** Simple mode: a mark stays on the page only while the backend does not have it yet. */
function isWaiting(ann: Annotation): boolean {
  return unconfirmed.has(ann.id) || !storage.isDelivered(ann.id)
}

function isSimpleVisible(ann: Annotation): boolean {
  return (ann.status === 'draft' || IN_WORK(ann)) && isWaiting(ann)
}

function updateSimpleStatus(): void {
  const all = storage.getAll()
  const inWork = all.filter((a) => a.status === 'in_progress' && !isWaiting(a)).length
  const waiting = all.filter((a) => IN_WORK(a) && !unconfirmed.has(a.id) && (a.status === 'pending' || !storage.isDelivered(a.id))).length
  toolbar.setSimpleStatus(inWork, waiting)

  const previous = statusSnapshot
  statusSnapshot = new Map(all.map((a) => [a.id, a.status]))
  if (!previous) return
  const claimed = all.filter((a) => a.status === 'fixed_unverified' && (previous.get(a.id) === 'pending' || previous.get(a.id) === 'in_progress'))
  if (claimed.length === 1) {
    const { comment } = claimed[0]
    showToast(themeManager.container, `Fixed: ${(voiceTranscript(comment) ?? comment).slice(0, 40)}`)
  }
  else if (claimed.length > 1) showToast(themeManager.container, `Fixed: ${claimed.length} marks`)
}

function refreshMarkers(): void {
  markers.clear()
  const attached: { ann: Annotation; el: HTMLElement }[] = []
  const otherBreakpoint: Annotation[] = []
  const detached: Annotation[] = []
  const route = currentRoute()
  const anns = storage.getByRoute(route).filter((ann) =>
    ann.status !== 'fixed_unverified' ? !options.simple || isSimpleVisible(ann)
      : !options.simple && reviewTargets(ann).length === 1,
  )
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
  refreshReview()

  if (options.simple) {
    updateSimpleStatus()
    return
  }

  const needsAttention = anns.filter(
    (a) => a.status === 'pending' || a.status === 'in_progress',
  ).length
  toolbar.setBadgeCount(needsAttention)
  if (options.submitFlow) {
    toolbar.setSubmitCount(anns.filter((a) => a.status === 'draft').length)
  }
}

interface PendingReview {
  id: string
  annotation: Annotation
  target: ReviewTarget
  index: number
  total: number
}

function pendingReview(): PendingReview[] {
  return storage.getAll().flatMap((stored) => {
    const annotation = savingReview.get(stored.id) ?? stored
    if (annotation.status !== 'fixed_unverified') return []
    const targets = reviewTargets(annotation)
    const checked = checkedVoiceTargets(annotation)
    return targets.flatMap((target, index) => checked.includes(index) ? [] : [{
      id: targets.length === 1 ? annotation.id : `${annotation.id}:${index + 1}`,
      annotation, target, index, total: targets.length,
    }])
  })
}

function findReviewElement(item: PendingReview): HTMLElement | null {
  const { id, target } = item
  const saved = getCachedElement(id)
  if (saved && !target.legacy) return saved
  if (target.legacy) {
    const { tag, path } = target.legacy
    const candidates = Array.from(document.getElementsByTagName(tag)).filter((element) =>
      !element.closest('[data-remarq-theme]') &&
      buildDomPath(element as HTMLElement) === path,
    )
    return candidates.length === 1 ? candidates[0] as HTMLElement : null
  }
  if (!target.fingerprint) return null
  return matchElement(target.fingerprint, options, true)
}

function refreshReview(): void {
  const items = pendingReview()
  const route = currentRoute()
  const descriptions: ReviewItem[] = []
  const attached = new Map<string, HTMLElement>()
  reviewMarkers.clear()
  for (const item of items) {
    const { id, annotation, target, index, total } = item
    const el = target.route === route ? findReviewElement(item) : null
    const transcript = voiceTranscript(annotation.comment)
    const voice = transcript !== undefined || annotation.fingerprint.voiceTargets?.length
    const grouped = voice || annotation.fingerprint.brushTargets?.length
    const original = target.legacy?.path || target.fingerprint?.domPath || target.fingerprint?.tagName
    if (el) attached.set(id, el)
    if (el && (options.simple || total > 1)) {
      reviewMarkers.add(id)
      markers.addMarker({ ...annotation, id }, el, total > 1 ? String(index + 1) : undefined)
    }
    const fix = [...annotation.lifecycle].reverse().find((event) => event.type === 'fix_claimed')
    let label = fix?.reason || annotation.comment
    if (grouped) {
      const before = target.fingerprint?.textContent
      const current = el && getTextContent(el, 241)
      const after = current && (current.length > 240 ? current.slice(0, 240) + '…' : current)
      const tag = el?.localName ?? target.fingerprint?.tagName ?? target.legacy?.tag
      label = after || before || el?.getAttribute('aria-label') || tag || 'Marked element'
      if (el && after && before && getTextContent(el) !== before) {
        label = `${before}${before.length === FINGERPRINT_TEXT_LIMIT ? '…' : ''} → ${after}`
      }
      if (!el) label = `${label} · ${target.route === route ? 'Target unavailable' : target.route}`
      label = `[${index + 1}] ${label}`
    }
    descriptions.push({
      id,
      label,
      comment: transcript ?? annotation.comment,
      route: target.route,
      markerLabel: grouped
        ? !el && target.route === route ? 'Target unavailable' : ''
        : el ? `Marked element · ${describeTarget(el) || el.tagName.toLowerCase()}`
          : target.route !== route ? `Marked element · ${target.viewport}`
            : `Target unavailable · ${target.viewport}. Original target: ${original}.`,
      ...(voice ? { voice: { id: annotation.id } } : { fixNote: fix?.reason }),
    })
  }
  toolbar.setVerificationBadgeCount(items.length)
  if (activeReview === null) return
  const active = items.find(({ id }) => id === activeReview) ??
    items.find(({ target }) => target.route === route) ?? items[0]
  if (!active) {
    closeReview(true)
    return
  }
  activeReview = active.id
  markers.setSelected(activeReview)
  const description = descriptions.find(({ id }) => id === activeReview)!
  reviewPanel.update(descriptions, description, active.target.route === route, attached.get(active.id), savingReview.has(active.annotation.id))
}

function openReview(id?: string): void {
  if (recording) return
  const items = pendingReview()
  const item = items.find((candidate) => candidate.id === id) ??
    items.find(({ target }) => target.route === currentRoute()) ?? items[0]
  if (!item) return
  popup.hide()
  qualityBubbles.suppress(null)
  setBrushing(false)
  setInspecting(false)
  activeReview = item.id
  toolbar.setReviewOpen(true)
  reviewPanel.element.hidden = false
  refreshMarkers()
  reviewPanel.reveal()
  reviewPanel.focus()
}

function closeReview(focus = false): void {
  if (activeReview === null) return
  activeReview = null
  markers.setSelected(null)
  toolbar.setReviewOpen(false)
  reviewPanel.hide()
  if (focus) toolbar.focusReview()
}

function confirmReview(): void {
  const item = pendingReview().find(({ id, target }) => id === activeReview && target.route === currentRoute())
  if (!item || savingReview.has(item.annotation.id)) return
  const { annotation, index, total } = item
  const changes: Partial<Annotation> = {}
  const checked = [...checkedVoiceTargets(annotation), index]
  if (total > 1) {
    changes.fingerprint = { ...annotation.fingerprint, voiceReview: { claim: reviewClaim(annotation), checked } }
  }
  if (checked.length === total) {
    const { status, event } = transition(annotation, 'verify', { actor: 'designer' })
    changes.status = status
    changes.lifecycle = [...annotation.lifecycle, event]
  }
  const store = storage
  savingReview.set(annotation.id, annotation)
  refreshMarkers()
  const saving = store.update(annotation.id, changes)
  persist(saving, 'Saving review')
  const settled = (): void => {
    if (!initialized || storage !== store) return
    savingReview.delete(annotation.id)
    if (activeReview === item.id) {
      const remaining = pendingReview()
      const current = remaining.find(({ id }) => id === item.id)
      const group = remaining.filter((entry) => entry.annotation.id === annotation.id)
      const next = group.find((entry) => entry.index > index) ?? group[0] ??
        remaining.find(({ target }) => target.route === currentRoute()) ?? remaining[0]
      if (!current && next) {
        openReview(next.id)
        return
      }
    }
    refreshMarkers()
  }
  saving.then(settled, settled)
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

function createAnnotation(target: HTMLElement, comment = ''): Annotation {
  const now = Date.now()
  return {
    id: generateId(),
    comment,
    fingerprint: createFingerprint(target, {
      classFilter: options.classFilter,
      dataAttribute: options.dataAttribute,
    }),
    route: currentRoute(),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    viewportBucket: toBucket(window.innerWidth),
    timestamp: now,
    status: options.submitFlow && !options.simple ? 'draft' : 'pending',
    lifecycle: [{ type: 'created', actor: 'designer', timestamp: now }],
  }
}

function saveAnnotation(annotation: Annotation): void {
  const saving = storage.add(annotation)
  persist(saving, 'Saving annotation')
  if (options.simple) {
    unconfirmed.add(annotation.id)
    const settled = (): void => {
      unconfirmed.delete(annotation.id)
      if (initialized) refreshMarkers()
    }
    saving.then(settled, settled)
  }
  refreshMarkers()
}

function closeRecording(): void {
  const voice = recording
  if (!voice) return
  recording = undefined
  clearTimeout(voice.timer)
  voice.markers.destroy()
  for (const { annotation } of voice.marks) elementCache.delete(annotation.id)
  setBrushing(false)
  setInspecting(false)
  toolbar.setVoiceState('idle', !!voiceMessage)
}

function cancelRecording(): void {
  const session = recording?.session
  closeRecording()
  abortSpeech(session)
}

function abortSpeech(session?: SpeechSession): void {
  try {
    session?.abort()
  } catch (error) {
    console.warn('[web-remarq] Could not abort speech recognition:', error)
  }
}

function toggleRecording(): void {
  if (!speech) return
  if (recording) {
    const voice = recording
    if (voice.stopping) return
    voice.stopping = true
    clearTimeout(voice.timer)
    setBrushing(false)
    setInspecting(false)
    toolbar.setVoiceState('stopping', !!voiceMessage)
    if (!voice.session) {
      finishRecording()
      return
    }
    voice.timer = setTimeout(() => {
      if (recording !== voice) return
      const session = voice.session
      finishRecording()
      abortSpeech(session)
    }, SPEECH_STOP_TIMEOUT)
    try {
      voice.session.stop()
    } catch {
      const session = voice.session
      finishRecording()
      abortSpeech(session)
    }
    return
  }

  setBrushing(false)
  setInspecting(false)
  closeReview()
  popup.hide()
  markers.setSelected(null)
  qualityBubbles.suppress(null)
  const voice: Recording = {
    attemptsWithoutSpeech: 0,
    startedAt: performance.now(),
    transcript: '',
    stopping: false,
    anchor: createAnnotation(document.body),
    marks: [],
    markers: new MarkerManager(themeManager.container),
  }
  recording = voice
  toolbar.setVoiceState('recording', !!voiceMessage)
  setInspecting(true)
  startSpeech(voice)
}

function resumeRecording(): void {
  const voice = recording
  if (!voice || voice.session || voice.stopping) return
  voice.attemptsWithoutSpeech = 0
  toolbar.setVoiceState('recording', !!voiceMessage)
  startSpeech(voice)
}

function startSpeech(voice: Recording): void {
  if (recording !== voice || !speech) return
  const prefix = voice.transcript
  let ended = false
  const onEnd = (error?: string): void => {
    if (ended || recording !== voice) return
    ended = true
    voice.session = undefined
    if (voice.stopping) {
      finishRecording()
      return
    }
    const transient = !error || error === 'no-speech' || error === 'network' || error === 'aborted'
    const delay = SPEECH_RETRY_DELAYS[voice.attemptsWithoutSpeech++]
    if (transient && delay !== undefined) {
      voice.timer = setTimeout(() => startSpeech(voice), delay)
      return
    }
    toolbar.setVoiceState('paused', !!voiceMessage, speechFailureMessage(error))
  }
  try {
    const session = speech.start({
      onTranscript: (transcript) => {
        if (ended || recording !== voice || !transcript.trim()) return
        const combined = [prefix, transcript.trim()].filter(Boolean).join(' ')
        if (combined !== voice.transcript) voice.attemptsWithoutSpeech = 0
        voice.transcript = combined
      },
      onEnd,
    })
    if (!ended && recording === voice) voice.session = session
  } catch (error) {
    onEnd(error instanceof Error ? error.name : 'start-failed')
  }
}

function speechFailureMessage(error = 'ended'): string {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
    case 'NotAllowedError':
      return `Speech paused (${error}). Allow microphone and speech recognition in your browser, then resume.`
    case 'audio-capture':
      return 'Speech paused (audio-capture). Connect or select a microphone, then resume.'
    case 'network':
      return 'Speech paused (network). Check your connection, then resume.'
    case 'language-not-supported':
      return 'Speech paused (language-not-supported). Check your browser’s speech languages.'
    default:
      return `Speech paused (${error}). Resume, finish, or cancel your feedback.`
  }
}

function finishRecording(): void {
  const voice = recording
  if (!voice) return
  const transcript = voice.transcript.trim()
  if (transcript || voice.marks.length) voiceMessage = formatVoiceMessage(transcript, voice.marks)
  const anchor = voice.marks[0]?.annotation ?? voice.anchor
  const target = getCachedElement(anchor.id)
  const elements = voice.marks.map(({ annotation }) => getCachedElement(annotation.id))
  closeRecording()

  if (!transcript && !voice.marks.length) {
    showToast(themeManager.container, 'No speech or elements were captured', 6000)
    return
  }

  // One regular annotation gives the existing outbox and both agent
  // transports one receipt for the complete recording.
  const fingerprint = {
    ...anchor.fingerprint,
    ...(voice.marks.length > 0 ? {
      voiceTargets: voice.marks.map(({ annotation: { fingerprint, route, viewport } }) => ({ fingerprint, route, viewport })),
    } : {}),
  }
  const annotation = { ...anchor, fingerprint, comment: voiceMessage }
  if (!validateAnnotation(annotation).ok) {
    showToast(themeManager.container, 'Could not save voice feedback. Copy it from Export.', 6000)
    return
  }
  if (target) cacheElement(annotation.id, target)
  if (elements.length > 1) {
    elements.forEach((element, index) => {
      if (element) cacheElement(`${annotation.id}:${index + 1}`, element)
    })
  }
  saveAnnotation(annotation)
  showToast(themeManager.container, 'Voice feedback added.')
}

function handleInspectClick(e: MouseEvent): void {
  if (!inspecting) return

  const target = e.target
  if (!(target instanceof Element) || target.closest('[data-remarq-theme]')) return
  const element = target as HTMLElement

  e.preventDefault()
  e.stopPropagation()

  if (recording && !recording.stopping) {
    addVoiceTargets(recording, [element])
    return
  }

  setInspecting(false)
  const rect = element.getBoundingClientRect()
  showAnnotationPopup([element], rect.left, rect.bottom + 8, rect.top - 8)
}

function addVoiceTargets(voice: Recording, targets: HTMLElement[]): void {
  const remaining = LIMITS.voiceTargets - voice.marks.length
  const elapsedMs = performance.now() - voice.startedAt
  for (const element of targets.slice(0, remaining)) {
    const annotation = createAnnotation(element, `Voice marker ${voice.marks.length + 1}`)
    voice.marks.push({ annotation, elapsedMs, transcript: voice.transcript })
    cacheElement(annotation.id, element)
    voice.markers.addMarker(annotation, element)
  }
  if (remaining < targets.length) showToast(themeManager.container, `Voice feedback holds up to ${LIMITS.voiceTargets} targets.`)
}

function setBrushing(active: boolean): void {
  brushing = active
  brush.setActive(active)
  toolbar.setBrushActive(active)
}

function toggleBrush(): void {
  if (recording?.stopping) return
  if (brushing) {
    setBrushing(false)
    if (recording) setInspecting(true)
    return
  }
  setInspecting(false)
  closeReview()
  popup.hide()
  markers.setSelected(null)
  qualityBubbles.suppress(null)
  setBrushing(true)
}

function handleBrushStroke(targets: HTMLElement[], point: { x: number; y: number }): void {
  if (recording) {
    addVoiceTargets(recording, targets)
    return
  }
  setBrushing(false)
  if (targets.length > LIMITS.voiceTargets) {
    showToast(themeManager.container, `Underline feedback holds up to ${LIMITS.voiceTargets} targets. Try a shorter stroke.`, 6000)
    return
  }
  showAnnotationPopup(targets, point.x, point.y + 8, point.y - 8, true)
}

function showAnnotationPopup(elements: HTMLElement[], x: number, y: number, anchorY: number, painted = false): void {
  const [element] = elements
  const anchor = painted ? createAnnotation(element) : undefined
  const brushTargets = anchor ? elements.map((target, index) => {
    const { fingerprint, route, viewport } = index === 0 ? anchor : createAnnotation(target)
    return { fingerprint, route, viewport }
  }) : undefined
  popup.show(
    {
      tag: element.tagName.toLowerCase(),
      text: painted && elements.length > 1 ? `${elements.length} elements` : describeTarget(element),
    },
    {
      top: window.scrollY + y,
      left: window.scrollX + x,
      anchorBottom: window.scrollY + anchorY,
    },
    (comment) => {
      const ann = anchor && brushTargets
        ? { ...anchor, comment, fingerprint: { ...anchor.fingerprint, brushTargets } }
        : createAnnotation(element, comment)
      if (brushTargets && !validateAnnotation(ann).ok) {
        showToast(themeManager.container, 'Could not save underline feedback. Try a shorter stroke or comment.', 6000)
        return
      }
      cacheElement(ann.id, element)
      if (elements.length > 1) {
        elements.forEach((target, index) => cacheElement(`${ann.id}:${index + 1}`, target))
      }
      saveAnnotation(ann)
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
  const target = e.target
  if (!(target instanceof Element) || target.closest('[data-remarq-theme]')) {
    overlay.hide()
    spacingOverlay.hide()
    return
  }

  const marked = markers.hasTarget(target) || recording?.markers.hasTarget(target) === true
  overlay.show(target, !spacingMode && !marked, marked)
  if (spacingMode && target instanceof HTMLElement) {
    spacingOverlay.show(target)
  } else {
    spacingOverlay.hide()
  }
}

function handleInspectKeydown(e: KeyboardEvent): void {
  if (options.shortcuts === false) return
  if (e.key === 'Escape' && brushing) {
    toggleBrush()
    return
  }
  if (e.key === 'Escape' && recording) {
    cancelRecording()
    return
  }
  if (e.key === 'Escape' && activeReview !== null) {
    closeReview(true)
    return
  }

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

  if (e.altKey && e.code === 'KeyI' && !recording) {
    e.preventDefault()
    setBrushing(false)
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
    closeReview()
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
  if (recording) return
  if (reviewMarkers.has(annotationId)) {
    openReview(annotationId)
    return
  }
  closeReview()
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

    if (fp.brushTargets) {
      const [agent] = generateAgentExport([ann], ann.viewportBucket).annotations
      if (agent.targets) lines.push('', formatAgentTargets(agent.targets))
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
  copyText(md)
}

function copyText(text: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(themeManager.container, 'Copied to clipboard')
    }).catch(() => {
      fallbackCopy(text)
    })
  } else {
    fallbackCopy(text)
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
    const copied = document.execCommand('copy')
    showToast(themeManager.container, copied ? 'Copied to clipboard' : 'Failed to copy')
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
  if (action === 'verify' && reviewTargets(ann).length > 1) {
    showToast(themeManager.container, 'Review each marked element to verify this feedback.')
    return
  }
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
      if (m.target instanceof Element && m.target.closest('[data-remarq-theme]')) continue
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
      brush = new Underline(themeManager.container, handleBrushStroke)
      spacingOverlay = new SpacingOverlay(themeManager.container)
      popup = new Popup(themeManager.container, options.simple)
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

      speech = options.speech === false ? undefined : options.speech ?? new WebSpeechAdapter()
      toolbar = new Toolbar(themeManager.container, {
        onInspect: () => {
          if (!recording) {
            setBrushing(false)
            setInspecting(!inspecting)
          }
        },
        onBrush: toggleBrush,
        ...(speech?.isSupported() ? {
          onVoice: toggleRecording,
          onResumeVoice: resumeRecording,
          onCancelVoice: cancelRecording,
          onCopyVoice: () => { if (voiceMessage) copyText(voiceMessage) },
        } : {}),
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
        onVerificationBadgeClick: () => {
          if (activeReview === null) openReview()
          else closeReview(true)
        },
        ...(options.submitFlow && !options.simple ? { onSubmit: () => submitAllDrafts() } : {}),
      }, position, options.simple)
      reviewPanel = new ReviewPanel({
        select: openReview,
        confirm: confirmReview,
        close: () => closeReview(true),
      }, toolbar.element)
      toolbar.element.appendChild(reviewPanel.element)

      routeObserver = new RouteObserver()
      unsubRoute = routeObserver.onChange(() => {
        if (brushing) toggleBrush()
        refreshMarkers()
      })

      document.addEventListener('click', handleInspectClick, true)
      document.addEventListener('mousemove', handleInspectHover)
      document.addEventListener('keydown', handleInspectKeydown)

      setupMutationObserver()
      initViewportListener(() => refreshMarkers())

      storage.onStatus(handleSyncStatus)

      const initialStorage = storage
      initialStorage.ready.then(() => {
        if (!initialized || storage !== initialStorage) return
        if (initialStorage.isMemoryOnly) {
          toolbar.setMemoryWarning(true)
          showToast(themeManager.container, 'Warning: localStorage unavailable - annotations live in memory only and are lost on reload', 6000)
        }
        refreshMarkers()
      }).catch((err: unknown) => {
        if (!initialized || storage !== initialStorage) return
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
      cancelRecording()
      speech = undefined
      voiceMessage = ''
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
      brush.destroy()
      spacingOverlay?.destroy()
      toolbar?.destroy()
      themeManager?.destroy()
      removeStyles()
      elementCache.clear()
      inspecting = false
      brushing = false
      spacingMode = false
      lastSyncState = null
      unconfirmed.clear()
      activeReview = null
      savingReview.clear()
      reviewMarkers.clear()
      statusSnapshot = null
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
