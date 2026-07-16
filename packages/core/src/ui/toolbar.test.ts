import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toolbar } from './toolbar'

const NOOP = {
  onInspect: () => {},
  onCopy: () => {},
  onExportMd: () => {},
  onExportJson: () => {},
  onImport: () => {},
  onClear: () => {},
  onThemeToggle: () => {},
  onSpacingToggle: () => {},
  onHelp: () => {},
}

describe('Toolbar submit button', () => {
  let container: HTMLElement
  let toolbar: Toolbar

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    toolbar?.destroy()
    container.remove()
  })

  it('is not rendered without onSubmit callback', () => {
    toolbar = new Toolbar(container, NOOP)
    expect(container.querySelector('[data-remarq-action="submit"]')).toBeNull()
  })

  it('is rendered disabled with onSubmit, enables when count > 0, fires callback', () => {
    const onSubmit = vi.fn()
    toolbar = new Toolbar(container, { ...NOOP, onSubmit })
    const btn = container.querySelector('[data-remarq-action="submit"]') as HTMLButtonElement
    expect(btn).not.toBeNull()
    expect(btn.disabled).toBe(true)

    toolbar.setSubmitCount(2)
    expect(btn.disabled).toBe(false)
    expect(btn.querySelector('.remarq-badge')?.textContent).toBe('2')

    btn.click()
    expect(onSubmit).toHaveBeenCalledTimes(1)

    toolbar.setSubmitCount(0)
    expect(btn.disabled).toBe(true)
    expect((btn.querySelector('.remarq-badge') as HTMLElement).style.display).toBe('none')
  })
})
