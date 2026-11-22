import { expect, it, vi } from 'vitest'
import { Underline } from './underline'

it('previews buttons along the anchored horizontal line, in both directions, and ignores distant marks', () => {
  document.body.innerHTML = '<button>A</button><button>B</button><div data-remarq-theme></div>'
  const buttons = [...document.querySelectorAll('button')]
  buttons.forEach((button, i) => vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(i * 100, 20, 100, 40)))
  const original = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint')
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: (x: number) => [buttons[Math.floor(x / 100)]] })
  const selected = vi.fn()
  const tool = new Underline(document.querySelector('div')!, selected)
  const layer = document.querySelector<SVGSVGElement>('.remarq-underline')!
  layer.setPointerCapture = vi.fn()
  layer.hasPointerCapture = () => false
  const pointer = (type: string, x: number, y: number) =>
    layer.dispatchEvent(Object.assign(new MouseEvent(type, { clientX: x, clientY: y }), { pointerId: 1 }))
  try {
    tool.setActive(true)
    pointer('pointerdown', 40, 68)
    pointer('pointermove', 85, 90)
    expect(layer.querySelectorAll('rect')).toHaveLength(1)
    expect(layer.querySelector('line')?.getAttribute('y2')).toBe('68')
    pointer('pointerup', 85, 90)
    expect(selected.mock.calls[0][0]).toEqual([buttons[0]])
    pointer('pointerdown', 170, 70)
    pointer('pointermove', 35, 110)
    expect(layer.querySelectorAll('rect')).toHaveLength(2)
    pointer('pointerup', 35, 110)
    expect(selected.mock.calls[1][0]).toEqual(buttons)
    pointer('pointerdown', 40, 105)
    pointer('pointerup', 180, 105)
    for (const y of [20, 40, 60, 84]) {
      pointer('pointerdown', 40, y)
      pointer('pointerup', 170, y)
      expect(selected).toHaveBeenLastCalledWith(buttons, { x: 170, y })
    }
    for (const y of [19, 85]) {
      pointer('pointerdown', 40, y)
      pointer('pointerup', 170, y)
    }
    expect(selected).toHaveBeenCalledTimes(6)
  } finally {
    tool.destroy()
    document.body.replaceChildren()
    if (original) Object.defineProperty(document, 'elementsFromPoint', original)
    else Reflect.deleteProperty(document, 'elementsFromPoint')
  }
})
