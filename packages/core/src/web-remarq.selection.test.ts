import { expect, it, vi } from 'vitest'
import { WebRemarq } from './web-remarq'
import { generateAgentExport } from './core/agent-export'

it('keeps the exact native selection across inline elements in storage and agent feedback', async () => {
  document.body.innerHTML = '<p>Before <em>selected</em> words after</p>'
  const block = document.querySelector('p')!
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
    expect(ann.fingerprint.selectedText).toBe('selected words')
    expect(generateAgentExport([ann], 1024).annotations[0].comment).toContain('Selected text: selected words\nContext: Before selected words after')
  } finally {
    WebRemarq.destroy()
    localStorage.clear()
    document.body.replaceChildren()
  }
})
