import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QualityBubbleManager } from './quality-bubble'
import type { QualityCheck } from '../core/types'

function verdict(score: QualityCheck['score']): QualityCheck {
  return { score, issues: [], clarifyingQuestions: [], refinedBy: 'auto', timestamp: 1 }
}

describe('QualityBubbleManager', () => {
  let container: HTMLElement
  let onClick: ReturnType<typeof vi.fn>
  let bubbles: QualityBubbleManager

  beforeEach(() => {
    document.body.innerHTML = ''
    container = document.createElement('div')
    document.body.appendChild(container)
    onClick = vi.fn()
    bubbles = new QualityBubbleManager(container, onClick)
  })

  const chip = (id: string) =>
    container.querySelector<HTMLElement>(`.remarq-quality-bubble[data-annotation-id="${id}"]`)

  it('renders a pending chip', () => {
    bubbles.setPending('a1')
    expect(chip('a1')!.textContent).toContain('🤖')
    expect(chip('a1')!.getAttribute('data-state')).toBe('pending')
  })

  it('shows the verdict for ambiguous / unactionable', () => {
    bubbles.setPending('a1')
    bubbles.setVerdict('a1', verdict('ambiguous'))
    expect(chip('a1')!.textContent).toBe('🤖 ambiguous')
    bubbles.setVerdict('a1', verdict('unactionable'))
    expect(chip('a1')!.textContent).toBe('🤖 unactionable')
  })

  it('removes the chip on clear verdict and on failure (null)', () => {
    bubbles.setPending('a1')
    bubbles.setVerdict('a1', verdict('clear'))
    expect(chip('a1')).toBeNull()
    bubbles.setPending('a2')
    bubbles.setVerdict('a2', null)
    expect(chip('a2')).toBeNull()
  })

  it('click reports the annotation id', () => {
    bubbles.setVerdict('a1', verdict('ambiguous'))
    chip('a1')!.click()
    expect(onClick).toHaveBeenCalledWith('a1')
  })

  it('suppress hides only the suppressed chip and un-hides on null', () => {
    bubbles.setVerdict('a1', verdict('ambiguous'))
    bubbles.setVerdict('a2', verdict('unactionable'))
    bubbles.suppress('a1')
    expect(chip('a1')!.style.display).toBe('none')
    expect(chip('a2')!.style.display).toBe('')
    bubbles.suppress(null)
    expect(chip('a1')!.style.display).toBe('')
  })

  it('a chip created while its id is suppressed starts hidden', () => {
    bubbles.suppress('a1')
    bubbles.setPending('a1')
    expect(chip('a1')!.style.display).toBe('none')
  })

  it('syncVisible drops chips whose marker is gone', () => {
    bubbles.setVerdict('a1', verdict('ambiguous'))
    bubbles.setVerdict('a2', verdict('ambiguous'))
    bubbles.syncVisible(new Set(['a2']))
    expect(chip('a1')).toBeNull()
    expect(chip('a2')).not.toBeNull()
  })

  it('updatePosition places the chip at the marker coordinates', () => {
    bubbles.setVerdict('a1', verdict('ambiguous'))
    bubbles.updatePosition('a1', 100, 200)
    expect(chip('a1')!.style.top).toBe('100px')
    expect(chip('a1')!.style.left).toBe('194px')
  })
})
