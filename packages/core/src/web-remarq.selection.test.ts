import { expect, it, vi } from 'vitest'
import { WebRemarq } from './web-remarq'
import { generateAgentExport } from './core/agent-export'

it.each(['p', 'button'])('keeps selected text anchored to its own %s', async (tag) => {
  document.body.innerHTML = `<section><button>Sibling</button><${tag} id="target">Before <em>selected</em> words after</${tag}></section>`
  const block = document.querySelector('#target')!
  const range = document.createRange()
  range.setStart(block.querySelector('em')!.firstChild!, 0)
  range.setEnd(block.lastChild!, 6)
  range.getBoundingClientRect = () => new DOMRect(10, 25, 80, 18)
  WebRemarq.init({ simple: true })
  try {
    await vi.waitFor(() => expect(document.querySelector('.remarq-toolbar')).toBeTruthy())
    const sel = document.getSelection()!
    sel.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    expect(sel.toString()).toBe('selected words')
    const action = document.querySelector<HTMLButtonElement>('.remarq-selection-comment')!
    expect(action.hidden).toBe(false)
    action.click()
    const popup = document.querySelector('.remarq-popup')!
    expect(popup.textContent).toContain('selected words')
    popup.querySelector('textarea')!.value = 'Rewrite'
    popup.querySelector<HTMLButtonElement>('.remarq-primary')!.click()
    const [ann] = WebRemarq.getAnnotations()
    expect(ann.fingerprint.id).toBe('target')
    expect(ann.fingerprint.selectedText).toBe('selected words')
    expect(generateAgentExport([ann], 1024).annotations[0].comment).toContain('Selected text: selected words\nContext: Before selected words after')
  } finally {
    WebRemarq.destroy()
    localStorage.clear()
    document.body.replaceChildren()
  }
})

it('starts a selection in button padding and consumes only the resulting drag click', async () => {
  document.body.innerHTML = '<button id="preview">Preview draft</button>'
  const button = document.querySelector('button')!
  const click = vi.fn()
  button.addEventListener('click', click)
  const rect = new DOMRect(20, 20, 100, 20)
  const original = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
  const caret = Object.getOwnPropertyDescriptor(document, 'caretPositionFromPoint')
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [rect] })
  Object.defineProperty(document, 'caretPositionFromPoint', { configurable: true,
    value: (x: number) => ({ offsetNode: button.firstChild, offset: x < 21 ? 0 : 13 }) })
  const pointer = (type: string, x: number) => button.dispatchEvent(Object.assign(
    new MouseEvent(type, { bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: 30 }),
    { pointerId: 1, pointerType: 'mouse' }))
  WebRemarq.init({ simple: true })
  try {
    pointer('pointerdown', 10)
    pointer('pointermove', 130)
    pointer('pointerup', 130)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(document.getSelection()?.toString()).toBe('Preview draft')
    expect(click).not.toHaveBeenCalled()
    pointer('pointerdown', 10)
    pointer('pointerup', 10)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(click).toHaveBeenCalledOnce()
  } finally {
    WebRemarq.destroy()
    document.getSelection()?.removeAllRanges()
    document.body.replaceChildren()
    if (original) Object.defineProperty(Range.prototype, 'getClientRects', original)
    else Reflect.deleteProperty(Range.prototype, 'getClientRects')
    if (caret) Object.defineProperty(document, 'caretPositionFromPoint', caret)
    else Reflect.deleteProperty(document, 'caretPositionFromPoint')
  }
})
