import { WebRemarq } from './web-remarq'
import { HttpStorageAdapter } from './core/http-storage-adapter'

// IIFE entry: expose the facade as a flat global so `WebRemarq.init(...)` works
// from a <script> tag. No `globalName` in tsup for this build - esbuild would
// otherwise wrap the multi-export module in a namespace object.
;(globalThis as unknown as { WebRemarq: typeof WebRemarq }).WebRemarq = WebRemarq

// Also expose HttpStorageAdapter on the same global so script-tag usage like
// `new WebRemarq.HttpStorageAdapter()` works without a bundler.
;(WebRemarq as unknown as { HttpStorageAdapter: typeof HttpStorageAdapter }).HttpStorageAdapter = HttpStorageAdapter
