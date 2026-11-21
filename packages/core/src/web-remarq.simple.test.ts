import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebRemarq } from './web-remarq'
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
    expect(statusText()?.textContent).toBe('In work: 1')
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
    expect(statusText()?.textContent).toBe('In work: 1')
  })

  it('counts pending and in_progress across routes, follows subscribe events and toasts on claim', async () => {
    const other = { ...makeAnnotation('b', 't2'), route: '/elsewhere' }
    const adapter = new ControlledAdapter([makeAnnotation('a', 't1'), other, makeAnnotation('c', 't2', 'fixed_unverified')])
    WebRemarq.init({ simple: true, storage: adapter })
    await tick()
    expect(statusText()?.textContent).toBe('In work: 2')
    expect(markerIds()).toEqual([])
    expect(toastText()).toBeNull()

    adapter.emit({ type: 'update', annotation: { ...makeAnnotation('a', 't1', 'in_progress') } })
    await raf()
    expect(statusText()?.textContent).toBe('In work: 2')

    adapter.emit({ type: 'update', annotation: { ...makeAnnotation('a', 't1', 'fixed_unverified', 'a'.repeat(60)) } })
    await raf()
    expect(statusText()?.textContent).toBe('In work: 1')
    expect(toastText()).toBe(`Fixed: ${'a'.repeat(40)}`)

    adapter.emit({ type: 'update', annotation: { ...makeAnnotation('b', 't2', 'dismissed') } })
    await raf()
    expect(statusText()?.style.display).toBe('none')
    expect(markerIds()).toEqual([])
  })

  it('renders no verification badge, lifecycle actions or history', async () => {
    const adapter = new ControlledAdapter([makeAnnotation('a', 't1', 'fixed_unverified')])
    adapter.undelivered.add('a')
    WebRemarq.init({ simple: true, storage: adapter })
    await tick()
    expect(document.querySelector('.remarq-toolbar-badge--verification')).toBeNull()
    ;(document.querySelector('.remarq-marker') as HTMLElement | null)?.click()
    const pending = makeAnnotation('p', 't2')
    adapter.emit({ type: 'add', annotation: pending })
    adapter.undelivered.add('p')
    adapter.emit({ type: 'update', annotation: pending })
    await raf()
    ;(document.querySelector('.remarq-marker[data-annotation-id="p"]') as HTMLElement).click()
    expect(document.querySelector('.remarq-popup-history')).toBeNull()
    expect(document.querySelector('.remarq-popup-actions-row--transitions')?.children.length).toBe(0)
  })

  it('treats adapters without delivery info as delivered right after save', async () => {
    const adapter = new ControlledAdapter()
    ;(adapter as { isDelivered?: unknown }).isDelivered = undefined
    WebRemarq.init({ simple: true, storage: adapter })
    await tick()
    await createMark(document.getElementById('t1')!, 'plain')
    await tick()
    expect(markerIds()).toEqual([])
    expect(statusText()?.textContent).toBe('In work: 1')
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
