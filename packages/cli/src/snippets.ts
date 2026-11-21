import { join, relative } from 'node:path'
import { remarqCall } from './vite-config'
import type { Detection, Edit } from './types'

// withRemarq() exposes the local token as NEXT_PUBLIC_WEB_REMARQ_TOKEN in
// development only; the component passes it through explicitly.
const WIDGET_INIT_NEXT = `'use client'
import { useEffect } from 'react'

export function RemarqDevTools() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    import('web-remarq').then(({ WebRemarq, HttpStorageAdapter }) => {
      WebRemarq.init({
        submitFlow: true,
        storage: new HttpStorageAdapter({ token: process.env.NEXT_PUBLIC_WEB_REMARQ_TOKEN }),
      })
    })
  }, [])
  return null
}`

/** Path relative to repoRoot, so the agent can open the file directly from where it runs. */
export function repoRelative(d: Detection, fileInApp: string): string {
  return relative(d.repoRoot, join(d.appDir, fileInApp)).split('\\').join('/')
}

function nextConfigEdit(d: Detection): Edit {
  return {
    file: d.configFile ? repoRelative(d, d.configFile) : '<next config not found>',
    kind: 'build-config',
    snippet: `import withRemarq from '@web-remarq/next'

export default withRemarq({
  // your existing Next.js config
})`,
    note: 'withRemarq wraps the whole config object. It is a no-op in production builds.',
  }
}

/**
 * The Vite config edit, printed only when init could not apply it itself.
 * `reason` says why, so the user knows what made the file unreadable.
 */
export function viteConfigEdit(d: Detection, widget: boolean, reason: string): Edit {
  return {
    file: d.configFile ? repoRelative(d, d.configFile) : '<vite config not found>',
    kind: 'build-config',
    snippet: `import remarq from '@web-remarq/unplugin/vite'

// inside defineConfig:
plugins: [/* your existing plugins */, ${remarqCall(d.includeGlob ?? [], widget)}]`,
    note: `Not edited automatically: ${reason}. The remarq plugin must come after the framework plugin (vue()/react()), so it sees the original source.`,
  }
}

function nextEntryEdit(d: Detection): Edit {
  if (!d.entry) {
    return {
      file: '<entry point not found>',
      kind: 'entry',
      snippet: WIDGET_INIT_NEXT,
      note: 'Could not locate the entry point automatically - locate the entry file yourself and add this there.',
    }
  }

  return {
    file: repoRelative(d, d.entry),
    kind: 'entry',
    snippet: WIDGET_INIT_NEXT,
    note: 'Create this component and render <RemarqDevTools /> inside the root layout body.',
  }
}

/** Next.js setup stays manual: wrapping the config and rendering a client component. */
export function nextEdits(d: Detection): Edit[] {
  return [nextConfigEdit(d), nextEntryEdit(d)]
}
