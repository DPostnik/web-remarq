import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Detection } from './types'

const MARKER = 'https://unpkg.com/web-remarq/dist/web-remarq.global.js'

export const SCRIPT_TAG = `    <!-- web-remarq (dev only) -->
    <script src="https://unpkg.com/web-remarq/dist/web-remarq.global.js"></script>
    <script>
      WebRemarq.init({ submitFlow: true, storage: new WebRemarq.HttpStorageAdapter() })
    </script>
`

/**
 * Insert the widget bootstrap before </body>. Safe to do deterministically -
 * no AST needed - which is why plain-HTML setup needs no agent at all.
 * Returns true when the file changed.
 */
export function injectScriptTag(d: Detection): boolean {
  const path = join(d.appDir, d.entry ?? 'index.html')
  if (!existsSync(path)) return false

  const html = readFileSync(path, 'utf8')
  if (html.includes(MARKER)) return false

  const idx = html.lastIndexOf('</body>')
  if (idx === -1) return false

  const next = `${html.slice(0, idx)}${SCRIPT_TAG}  ${html.slice(idx)}`
  writeFileSync(path, next, 'utf8')
  return true
}
