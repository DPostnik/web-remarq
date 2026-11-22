import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebRemarq } from './web-remarq'
import { generateAgentExport } from './core/agent-export'
import { checkedVoiceTargets } from './core/voice-message'
import type { Annotation, AnnotationStore, StorageAdapter, StorageChangeEvent } from './core/types'

function makeAnnotation(id: string, anchorId: string, status: Annotation['status'] = 'pending', comment = `Fix ${anchorId}`): Annotation {
  return {
    id, comment, route: '/', viewport: '1024x768', viewportBucket: 1000, timestamp: 1_700_000_000_000,
    status,
    lifecycle: [{ type: 'created', actor: 'designer', timestamp: 1_700_000_000_000 }],
    fingerprint: {
      dataAnnotate: null, dataTestId: null, id: anchorId, tagName: 'button', textContent: 'Click me',
      role: null, ariaLabel: null, stableClasses: [], domPath: 'body > button', siblingIndex: 0,
      parentAnchor: null, rawClasses: [], cssModules: [], sourceLocation: null, componentName: null,
      detectedSource: null, detectedComponent: null,
    },
  }
}

/** Adapter whose "backend has it" answer and change events the test controls. */
class ControlledAdapter implements StorageAdapter {
  undelivered = new Set<string>()
  saveGate: Promise<void> = Promise.resolve()
  saved: Annotation[] = []
  listeners = new Set<(e: StorageChangeEvent) => void>()
  constructor(private initial: Annotation[] = []) {}
  async load(): Promise<AnnotationStore | null> { return { version: 1, annotations: this.initial } }
  async save(a: Annotation): Promise<void> {
    await this.saveGate
    this.saved.push(a)
  }
  async remove(): Promise<void> {}
  async clear(): Promise<void> {}
  subscribe(cb: (e: StorageChangeEvent) => void): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }
  isDelivered(id: string): boolean { return !this.undelivered.has(id) }
  emit(e: StorageChangeEvent): void { for (const cb of this.listeners) cb(e) }
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const raf = () => new Promise((r) => requestAnimationFrame(() => r(undefined)))
const markerIds = () => Array.from(document.querySelectorAll('.remarq-marker')).map((m) => m.getAttribute('data-annotation-id'))
const statusText = () => (document.querySelector('.remarq-simple-status') as HTMLElement | null)
const toastText = () => document.querySelector('.remarq-toast')?.textContent ?? null
const reviewButton = () => document.querySelector<HTMLButtonElement>('[data-remarq-action="review"]')!
const verifyButton = () => document.querySelector<HTMLButtonElement>('.remarq-review-actions button')!

function addButton(id: string): HTMLElement {
  const el = document.createElement('button')
  el.id = id
  el.textContent = 'Click me'
  document.body.appendChild(el)
  return el
}

async function createMark(target: HTMLElement, comment: string): Promise<void> {
  ;(document.querySelector('[data-remarq-action="inspect"]') as HTMLElement).click()
  target.click()
  const ta = document.querySelector('.remarq-popup textarea') as HTMLTextAreaElement
  ta.value = comment
  ;(document.querySelector('.remarq-popup .remarq-primary') as HTMLElement).click()
}

describe('simple mode', () => {
  beforeEach(() => { addButton('t1'); addButton('t2') })
  afterEach(() => {
    WebRemarq.destroy()
    document.body.innerHTML = ''
  })

  it('creates pending annotations even with submitFlow, and renders no submit button', async () => {
    const adapter = new ControlledAdapter()
    WebRemarq.init({ simple: true, submitFlow: true, storage: adapter })
    await tick()
    expect(document.querySelector('[data-remarq-action="submit"]')).toBeNull()
    await createMark(document.getElementById('t1')!, 'make it blue')
    expect(WebRemarq.getAnnotations()[0].status).toBe('pending')
  })

  it('keeps the marker until the save is confirmed, then hides it', async () => {
    const adapter = new ControlledAdapter()
    let release!: () => void
    adapter.saveGate = new Promise<void>((r) => { release = r })
    WebRemarq.init({ simple: true, storage: adapter })
    await tick()
    await createMark(document.getElementById('t1')!, 'make it blue')
    expect(markerIds()).toHaveLength(1)
    release()
    await tick()
    expect(markerIds()).toHaveLength(0)
    expect(statusText()?.textContent).toBe('Waiting for agent: 1')
  })

  it('keeps marks visible and shows "Waiting for agent" while the backend does not have them', async () => {
    const adapter = new ControlledAdapter()
    WebRemarq.init({ simple: true, storage: adapter })
    await tick()
    await createMark(document.getElementById('t1')!, 'offline mark')
    const id = WebRemarq.getAnnotations()[0].id
    adapter.undelivered.add(id)
    await tick()
    await raf()
    expect(markerIds()).toEqual([id])
    expect(statusText()?.textContent).toBe('Waiting for agent: 1')
    expect(statusText()?.getAttribute('data-state')).toBe('waiting')

    // click on the waiting mark still opens the editor with delete
    ;(document.querySelector('.remarq-marker') as HTMLElement).click()
    expect(document.querySelector('.remarq-popup')?.textContent).toContain('Delete')

    // backend catches up: delivered event
    adapter.undelivered.delete(id)
    adapter.emit({ type: 'update', annotation: WebRemarq.getAnnotations()[0] })
    await raf()
    expect(markerIds()).toEqual([])
    expect(statusText()?.textContent).toBe('Waiting for agent: 1')
  })

  it('counts pending and in_progress separately across routes, follows subscribe events and toasts on claim', async () => {
    const other = { ...makeAnnotation('b', 't2'), route: '/elsewhere' }
    const adapter = new ControlledAdapter([makeAnnotation('a', 't1'), other, makeAnnotation('c', 't2', 'fixed_unverified')])
    WebRemarq.init({ simple: true, storage: adapter })
    await tick()
    expect(statusText()?.textContent).toBe('Waiting for agent: 2')
    expect(markerIds()).toEqual(['c'])
    expect(toastText()).toBeNull()
    expect(reviewButton().textContent).toBe('Review 1')

    adapter.emit({ type: 'update', annotation: { ...makeAnnotation('a', 't1', 'in_progress') } })
    await raf()
    expect(statusText()?.textContent).toBe('In work: 1 | Waiting for agent: 1')

    adapter.emit({ type: 'update', annotation: { ...makeAnnotation('a', 't1', 'fixed_unverified', 'a'.repeat(60)) } })
    await raf()
    expect(statusText()?.textContent).toBe('Waiting for agent: 1')
    expect(toastText()).toBe(`Fixed: ${'a'.repeat(40)}`)

    adapter.emit({ type: 'update', annotation: { ...makeAnnotation('b', 't2', 'dismissed') } })
    await raf()
    expect(statusText()?.style.display).toBe('none')
    expect(markerIds()).toEqual(['a', 'c'])
    expect(reviewButton().textContent).toBe('Review 2')
  })

  it('keeps lifecycle actions and history out of the simple waiting-mark editor', async () => {
    const adapter = new ControlledAdapter([makeAnnotation('a', 't1', 'fixed_unverified')])
    adapter.undelivered.add('a')
    WebRemarq.init({ simple: true, storage: adapter })
    await tick()
    expect(reviewButton().textContent).toBe('Review 1')
    const pending = makeAnnotation('p', 't2')
    adapter.emit({ type: 'add', annotation: pending })
    adapter.undelivered.add('p')
    adapter.emit({ type: 'update', annotation: pending })
    await raf()
    ;(document.querySelector('.remarq-marker[data-annotation-id="p"]') as HTMLElement).click()
    expect(document.querySelector('.remarq-popup-history')).toBeNull()
    expect(document.querySelector('.remarq-popup-actions-row--transitions')?.children.length).toBe(0)
  })

  it('persists partial voice review across widget reloads and verifies only after all targets are checked', async () => {
    const payload = 'Voice feedback\n\nFix this [1] and this [2].\n\n' +
      '[1] 1.0s · / · 1024x768\n  Element: <button> body > button\n  Search: t1\n' +
      '[2] 2.0s · / · 1024x768\n  Source: app.ts:12:4\n  Element: <button> body > button\n  Search: t2'
    const first = makeAnnotation('voice', 't1', 'fixed_unverified', payload)
    const second = makeAnnotation('second', 't2')
    first.fingerprint.voiceTargets = [first, second].map(({ fingerprint, route, viewport }) => ({
      fingerprint: { ...fingerprint, voiceTargets: undefined }, route, viewport,
    }))
    first.lifecycle.push({ type: 'fix_claimed', actor: 'agent', timestamp: first.timestamp + 1, reason: 'Agent fix details' })
    document.getElementById('t2')!.textContent = 'Save changes'
    const initial = new ControlledAdapter([makeAnnotation('other', 't1', 'fixed_unverified'), first])
    WebRemarq.init({ simple: true, storage: initial })
    await tick()
    expect(markerIds()).toEqual(['other', 'voice:1', 'voice:2'])
    document.querySelector<HTMLElement>('.remarq-marker[data-annotation-id="voice:1"]')!.click()
    const review = document.querySelector('[data-remarq-theme] > .remarq-review')!
    const [, markOne, markTwo] = review.querySelectorAll<HTMLButtonElement>('.remarq-review-mark')
    expect(review.querySelector('.remarq-review-comment')?.textContent).toBe('Fix this [1] and this [2].')
    expect(review.textContent).not.toMatch(/Voice feedback|app\.ts|Search:|Agent fix details/)
    expect(review.querySelector('.remarq-review-comment button')).toBeNull()
    expect(markTwo.textContent).toBe('[2] Click me → Save changes')
    expect(markOne.getAttribute('aria-pressed')).toBe('true')
    markTwo.focus()
    markTwo.click()
    expect(markTwo.getAttribute('aria-pressed')).toBe('true')
    expect(markOne.getAttribute('aria-pressed')).toBe('false')
    expect(document.activeElement).toBe(markTwo)
    markOne.click()
    verifyButton().click()
    await tick()
    const partial = initial.saved[0]
    expect(partial.status).toBe('fixed_unverified')
    expect(partial.lifecycle).toEqual(first.lifecycle)
    expect(partial.comment).toBe(payload)
    expect(checkedVoiceTargets(partial)).toEqual([0])
    expect(reviewButton().textContent).toBe('Review 2')
    expect(review.querySelector('.remarq-review-mark[aria-pressed="true"]')?.textContent).toBe('[2] Click me → Save changes')
    WebRemarq.destroy()

    document.getElementById('t2')?.remove()
    const reloaded = new ControlledAdapter([partial])
    WebRemarq.init({ simple: true, storage: reloaded })
    await tick()
    expect(markerIds()).toEqual([])
    reviewButton().click()
    expect(document.querySelector('.remarq-review-target')?.textContent).toContain('Target unavailable')
    expect(verifyButton().textContent).toBe('Verify manually')
    verifyButton().click()
    await tick()
    expect(reloaded.saved[0].status).toBe('verified')
    expect(reloaded.saved[0].lifecycle.slice(-1)[0]).toMatchObject({ type: 'verified', actor: 'designer' })
    expect(reviewButton().hidden).toBe(true)
  })

  it('treats adapters without delivery info as delivered right after save', async () => {
    const adapter = new ControlledAdapter()
    ;(adapter as { isDelivered?: unknown }).isDelivered = undefined
    WebRemarq.init({ simple: true, storage: adapter })
    await tick()
    await createMark(document.getElementById('t1')!, 'plain')
    await tick()
    expect(markerIds()).toEqual([])
    expect(statusText()?.textContent).toBe('Waiting for agent: 1')
  })

  it('sends a correction for the selected target and reviews the next claim from the start', async () => {
    const mark = makeAnnotation('voice', 't1', 'fixed_unverified', 'Voice feedback\n\nAdjust [1] and [2].')
    const second = makeAnnotation('second', 't2')
    second.fingerprint.domPath = 'body > button#t2'
    mark.fingerprint.voiceTargets = [mark, second].map(({ fingerprint, route, viewport }) => ({
      fingerprint: { ...fingerprint, voiceTargets: undefined }, route, viewport,
    }))
    mark.lifecycle.push({ type: 'fix_claimed', actor: 'agent', timestamp: mark.timestamp + 1 })
    const adapter = new ControlledAdapter([mark])
    WebRemarq.init({ simple: true, storage: adapter })
    await tick()
    reviewButton().click()
    verifyButton().click()
    await tick()
    expect(checkedVoiceTargets(adapter.saved[0])).toEqual([0])

    const panel = document.querySelector('.remarq-review')!
    const reject = [...panel.querySelectorAll('button')].find((button) => button.textContent === 'Return for correction')!
    reject.click()
    const reason = panel.querySelector<HTMLTextAreaElement>('textarea')!
    expect(document.activeElement).toBe(reason)
    const send = panel.querySelector<HTMLButtonElement>('button[type="submit"]')!
    reason.value = '  '
    send.click()
    expect(adapter.saved).toHaveLength(1)
    reason.value = 'The second button still clips on mobile.'
    send.click()
    await tick()
    const returned = adapter.saved[1]
    expect(returned.status).toBe('pending')
    expect(returned.comment).toBe(mark.comment)
    expect(generateAgentExport([returned], 1000).annotations[0].comment).toContain('Correction requested: Target [2] (/ · body > button#t2): The second button still clips on mobile.')
    expect(returned.lifecycle.slice(-1)[0]).toMatchObject({
      type: 'rejected', actor: 'designer', reason: 'Target [2] (/ · body > button#t2): The second button still clips on mobile.',
    })
    expect(reviewButton().hidden).toBe(true)

    adapter.emit({ type: 'update', annotation: {
      ...returned, status: 'fixed_unverified', lifecycle: [...returned.lifecycle,
        { type: 'fix_claimed', actor: 'agent', timestamp: returned.timestamp + 3 }],
    } })
    await raf()
    expect(reviewButton().textContent).toBe('Review 2')
  })

  it('unsubscribes and removes its DOM on destroy', async () => {
    const adapter = new ControlledAdapter([makeAnnotation('a', 't1')])
    WebRemarq.init({ simple: true, storage: adapter })
    await tick()
    expect(adapter.listeners.size).toBe(1)
    WebRemarq.destroy()
    expect(adapter.listeners.size).toBe(0)
    expect(document.querySelector('[data-remarq-theme]')).toBeNull()
    expect(document.querySelector('.remarq-simple-status')).toBeNull()
  })

  it('changes nothing when simple is off', async () => {
    const adapter = new ControlledAdapter([makeAnnotation('a', 't1')])
    WebRemarq.init({ submitFlow: true, storage: adapter })
    await tick()
    expect(document.querySelector('[data-remarq-action="submit"]')).not.toBeNull()
    expect(document.querySelector('.remarq-simple-status')).toBeNull()
    expect(markerIds()).toEqual(['a'])
    await createMark(document.getElementById('t2')!, 'draft one')
    expect(WebRemarq.getAnnotations().find((a) => a.comment === 'draft one')?.status).toBe('draft')
  })
})
