import { join, relative } from 'node:path'
import type { Detection, Edit } from './types'

// The Vite widget needs no token in source: HttpStorageAdapter asks the dev
// server for it (the remarq plugin serves /__web-remarq/config.json in dev).
const WIDGET_INIT_VITE = `import { WebRemarq, HttpStorageAdapter } from 'web-remarq'

if (import.meta.env.DEV) {
  WebRemarq.init({ submitFlow: true, storage: new HttpStorageAdapter() })
}`

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
function repoRelative(d: Detection, fileInApp: string): string {
  return relative(d.repoRoot, join(d.appDir, fileInApp)).split('\\').join('/')
}

function buildConfigEdit(d: Detection): Edit {
  if (d.framework === 'next') {
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

  const include = `[${(d.includeGlob ?? []).map((glob) => `'${glob}'`).join(', ')}]`
  return {
    file: d.configFile ? repoRelative(d, d.configFile) : '<vite config not found>',
    kind: 'build-config',
    snippet: `import remarq from '@web-remarq/unplugin/vite'

// inside defineConfig:
plugins: [/* your existing plugins */, remarq({ include: ${include} })]`,
    note: 'The remarq plugin must come after the framework plugin (vue()/react()), so it sees the original source.',
  }
}

function entryEdit(d: Detection): Edit {
  const snippet = d.framework === 'next' ? WIDGET_INIT_NEXT : WIDGET_INIT_VITE

  if (!d.entry) {
    return {
      file: '<entry point not found>',
      kind: 'entry',
      snippet,
      note: 'Could not locate the entry point automatically - locate the entry file yourself and add this there.',
    }
  }

  return {
    file: repoRelative(d, d.entry),
    kind: 'entry',
    snippet,
    note:
      d.framework === 'next'
        ? 'Create this component and render <RemarqDevTools /> inside the root layout body.'
        : 'Dev-only: the guard keeps web-remarq out of production bundles.',
  }
}

export function buildEdits(d: Detection): Edit[] {
  if (d.framework === 'plain-html') return []
  return [buildConfigEdit(d), entryEdit(d)]
}
