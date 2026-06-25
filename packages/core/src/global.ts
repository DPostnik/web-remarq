import { WebRemarq } from './web-remarq'

// IIFE entry: expose the facade as a flat global so `WebRemarq.init(...)` works
// from a <script> tag. No `globalName` in tsup for this build — esbuild would
// otherwise wrap the multi-export module in a namespace object.
;(globalThis as unknown as { WebRemarq: typeof WebRemarq }).WebRemarq = WebRemarq
