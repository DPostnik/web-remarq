import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebRemarq } from './web-remarq'
import { WebSpeechAdapter, type SpeechCallbacks } from './core/speech'
import { LocalStorageAdapter } from './core/local-storage-adapter'

function startWidget(opts: { simple?: boolean; submitFlow?: boolean } = {}) {
  let callbacks: SpeechCallbacks
  const session = { stop: vi.fn(), abort: vi.fn() }
  const storage = new LocalStorageAdapter()
  const save = vi.spyOn(storage, 'save')
  const start = vi.fn((listeners: SpeechCallbacks) => {
    callbacks = listeners
    return session
  })
  WebRemarq.init({
    ...opts,
    storage,
    speech: {
      isSupported: () => true,
      start,
    },
  })
  return {
    save,
    start,
    session,
    transcript: (transcript: string) => callbacks.onTranscript(transcript),
    end: (error?: string) => callbacks.onEnd(error),
  }
}

function button(action: string): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`[data-remarq-action="${action}"]`)!
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('voice feedback', () => {
  afterEach(async () => {
    await tick()
    WebRemarq.destroy()
    document.body.replaceChildren()
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('places numbered markers, waits for the final words and saves and copies a single pending message', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    document.body.innerHTML = '<button id="hero" data-remarq-source="Hero.tsx:3:1">Start</button><p data-testid="subtitle">Subtitle</p>'
    const voice = startWidget({ simple: true, submitFlow: true })
    await tick()

    expect(button('copy-voice').hidden).toBe(true)
    button('voice').click()
    voice.transcript('Make')
    document.querySelector<HTMLElement>('#hero')!.click()
    voice.transcript('Make this bigger then')
    document.querySelector<HTMLElement>('p')!.click()
    expect([...document.querySelectorAll('.remarq-marker')].map((marker) => marker.textContent)).toEqual(['1', '2'])
    expect(document.querySelector('.remarq-popup')).toBeNull()

    button('voice').click()
    expect(voice.session.stop).toHaveBeenCalledOnce()
    expect(voice.save).not.toHaveBeenCalled()
    voice.transcript('Make this bigger, then fix the subtitle.')
    voice.end()
    await tick()

    expect(voice.save).toHaveBeenCalledOnce()
    const [annotation] = voice.save.mock.calls[0]
    expect(annotation.status).toBe('pending')
    expect(annotation.fingerprint.id).toBe('hero')
    expect(annotation.fingerprint.voiceTargets).toMatchObject([
      { route: '/', fingerprint: { id: 'hero' } },
      { route: '/', fingerprint: { dataTestId: 'subtitle' } },
    ])
    expect(annotation.comment).toContain('Make [1] this bigger, then [2] fix the subtitle.')
    expect(annotation.comment).toContain('Source: Hero.tsx:3:1')
    expect(annotation.comment).toContain('data-testid="subtitle"')
    expect(annotation.comment).toMatch(/\[2\] \d+\.\ds/)
    const menu = button('copy-voice').closest<HTMLElement>('.remarq-export-menu')!
    expect(menu.hidden).toBe(true)
    expect(button('copy').hidden).toBe(false)
    button('export').click()
    expect(menu.hidden).toBe(false)
    expect(button('copy-voice').hidden).toBe(false)
    button('copy-voice').click()
    expect(writeText).toHaveBeenCalledExactlyOnceWith(annotation.comment)
    expect(menu.hidden).toBe(true)
  })

  it('respects manual submit flow for voice feedback without an element', async () => {
    const voice = startWidget({ submitFlow: true })
    await tick()
    button('voice').click()
    voice.transcript('Change the page layout')
    button('voice').click()
    voice.end()
    await tick()
    expect(voice.save).toHaveBeenCalledOnce()
    expect(WebRemarq.getAnnotations()[0]).toMatchObject({ status: 'draft', fingerprint: { tagName: 'body' } })
  })

  it('keeps marks and transcript across recognition cycles and pauses after bounded retries', async () => {
    document.body.innerHTML = '<p>First</p><h1>Second</h1>'
    const voice = startWidget()
    await tick()
    vi.useFakeTimers()
    try {
      button('voice').click()
      voice.transcript('First item')
      document.querySelector('p')!.click()
      voice.end()
      expect(button('voice').classList.contains('remarq-active')).toBe(true)
      expect(document.querySelector('.remarq-marker')?.textContent).toBe('1')
      await vi.advanceTimersByTimeAsync(250)
      voice.transcript('Second item')
      document.querySelector('h1')!.click()
      expect([...document.querySelectorAll('.remarq-marker')].map((marker) => marker.textContent)).toEqual(['1', '2'])

      for (const delay of [250, 1000, 2000]) {
        voice.end('network')
        await vi.advanceTimersByTimeAsync(delay)
      }
      voice.end('network')
      await vi.advanceTimersByTimeAsync(6000)
      expect(voice.start).toHaveBeenCalledTimes(5)
      expect(document.querySelector('.remarq-voice-paused [role="status"]')?.textContent).toContain('(network)')
      expect(button('resume-voice').parentElement?.hidden).toBe(false)
      expect(document.querySelectorAll('.remarq-marker')).toHaveLength(2)
      expect(voice.save).not.toHaveBeenCalled()
      button('resume-voice').click()
      expect(voice.start).toHaveBeenCalledTimes(6)
      voice.transcript('More feedback')
      voice.end('not-allowed')
      expect(document.querySelector('.remarq-voice-paused [role="status"]')?.textContent).toContain('(not-allowed)')
      button('finish-voice').click()
      expect(voice.save).toHaveBeenCalledOnce()
      expect(voice.save.mock.calls[0][0].comment).toContain('First item [1] Second item [2] More feedback')
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores callbacks from a canceled recording', async () => {
    const voice = startWidget()
    await tick()
    button('voice').click()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(voice.session.abort).toHaveBeenCalledOnce()
    voice.transcript('Canceled feedback')
    voice.end()
    expect(voice.save).not.toHaveBeenCalled()
    expect(button('voice').classList.contains('remarq-active')).toBe(false)
  })

  it('leaves typed feedback available when speech is unsupported', async () => {
    WebRemarq.init({
      speech: { isSupported: () => false, start: vi.fn() },
    })
    expect(button('voice')).toBeNull()
    expect(button('inspect')).toBeTruthy()
  })

  it('uses prefixed browser recognition and keeps provisional words if the engine ends', () => {
    const recognition = { start: vi.fn(), stop: vi.fn(), abort: vi.fn() }
    vi.stubGlobal('webkitSpeechRecognition', class {
      constructor() { return recognition }
    })
    const callbacks = { onTranscript: vi.fn(), onEnd: vi.fn() }
    const adapter = new WebSpeechAdapter('pl')
    expect(adapter.isSupported()).toBe(true)
    const session = adapter.start(callbacks)
    expect(recognition).toMatchObject({ lang: 'pl', interimResults: true, continuous: true })
    const handlers = recognition as typeof recognition & {
      onresult: (event: unknown) => void
      onend: () => void
    }
    handlers.onresult({ results: [
      { isFinal: true, 0: { transcript: 'Zmień' } },
      { isFinal: false, 0: { transcript: 'tytuł' } },
    ] })
    expect(callbacks.onTranscript).toHaveBeenLastCalledWith('Zmień tytuł')
    session.stop()
    expect(recognition.stop).toHaveBeenCalledOnce()
    handlers.onend()
    expect(callbacks.onTranscript).toHaveBeenLastCalledWith('Zmień tytuł')
    expect(callbacks.onEnd).toHaveBeenCalledOnce()
  })
})
