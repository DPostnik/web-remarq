import { createRequire } from 'module'
import { join } from 'path'

export const WIDGET_MODULE_ID = 'virtual:web-remarq/widget'
export const WIDGET_RESOLVED_ID = `\0${WIDGET_MODULE_ID}`
/** URL Vite serves a `\0`-prefixed virtual module under. */
export const WIDGET_SCRIPT_SRC = `/@id/__x00__${WIDGET_MODULE_ID}`

const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const
const THEMES = ['light', 'dark'] as const

export interface WidgetOptions {
  /** Simple mode: marks go to the agent by themselves and leave the page once delivered. Default: true. */
  simple?: boolean
  position?: (typeof POSITIONS)[number]
  theme?: (typeof THEMES)[number]
}

/**
 * Only whitelisted, validated primitives reach the generated module, and they
 * are embedded as JSON: no option value can become code.
 */
export function widgetInitOptions(widget: boolean | WidgetOptions | undefined): Record<string, unknown> | null {
  if (!widget) return null
  const given: WidgetOptions = widget === true ? {} : widget
  const init: Record<string, unknown> = { simple: given.simple !== false }
  if ((POSITIONS as readonly unknown[]).includes(given.position)) init.position = given.position
  if ((THEMES as readonly unknown[]).includes(given.theme)) init.theme = given.theme
  return init
}

export function widgetModuleSource(widget: boolean | WidgetOptions | undefined): string {
  const init = widgetInitOptions(widget) ?? {}
  return `import { WebRemarq, HttpStorageAdapter } from 'web-remarq'

WebRemarq.init({ ...${JSON.stringify(init)}, storage: new HttpStorageAdapter() })
`
}

/** True when `web-remarq` can be resolved from the user's project root. */
export function canResolveWidgetPackage(root: string): boolean {
  try {
    createRequire(join(root, 'noop.js')).resolve('web-remarq')
    return true
  } catch {
    return false
  }
}
