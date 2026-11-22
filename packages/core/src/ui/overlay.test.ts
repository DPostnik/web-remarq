import { afterEach, describe, expect, it } from 'vitest'
import { Overlay } from './overlay'

describe('inspect overlay', () => {
  let overlay: Overlay | undefined

  afterEach(() => {
    overlay?.destroy()
    document.body.replaceChildren()
    Reflect.deleteProperty(document.documentElement, 'clientWidth')
    Reflect.deleteProperty(document.documentElement, 'clientHeight')
  })

  function setup(left: number, top: number) {
    Object.defineProperties(document.documentElement, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
    })
    const target = document.createElement('p')
    Object.defineProperties(target, { offsetWidth: { value: 121 }, offsetHeight: { value: 32 } })
    let rect = new DOMRect(left, top, 120.5, 32.25)
    target.getBoundingClientRect = () => rect
    const root = document.createElement('div')
    document.body.append(target, root)
    overlay = new Overlay(root)
    const highlight = root.querySelector<HTMLElement>('.remarq-overlay')!
    const tooltip = root.querySelector<HTMLElement>('.remarq-tooltip')!
    Object.defineProperties(tooltip, { offsetWidth: { value: 140 }, offsetHeight: { value: 24 } })
    return { target, highlight, tooltip, move: (x: number, y: number) => { rect = new DOMRect(x, y, 120.5, 32.25) } }
  }

  it('uses the fractional border box and follows a scrolling target', () => {
    const { target, highlight, tooltip, move } = setup(100, 80)
    overlay!.show(target, true, false)
    expect(highlight.style.width).toBe('120.5px')
    expect(highlight.style.height).toBe('32.25px')
    expect(tooltip.style.top).toBe('48px')

    move(70, 10)
    target.dispatchEvent(new Event('scroll'))
    expect(highlight.style.left).toBe('70px')
    expect(highlight.style.top).toBe('10px')
    expect(tooltip.style.top).toBe('50.25px')
  })

  it('keeps the marked label outside the box and leaves room for its badge', () => {
    const { target, highlight, tooltip } = setup(270, 40)
    overlay!.show(target, false, true)
    expect(highlight.style.display).toBe('none')
    expect(tooltip.style.left).toBe('114px')
    expect(tooltip.style.top).toBe('40px')
  })

  it('puts the label below a marked element near the top when the sides are occupied', () => {
    const { target, tooltip } = setup(130, 40)
    overlay!.show(target, false, true)
    expect(tooltip.style.left).toBe('130px')
    expect(tooltip.style.top).toBe('88.25px')
  })
})
