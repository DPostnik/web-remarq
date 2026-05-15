export type {
  Annotation,
  AnnotationStore,
  ElementFingerprint,
  CSSModuleClass,
  SourceDetectionResult,
  SearchConfidence,
  GrepQuery,
  AgentSearchHints,
  AgentAnnotationSource,
  AgentAnnotation,
  AgentExport,
  ToolbarPosition,
  StorageAdapter,
  StorageChangeEvent,
} from './types'
export { createFingerprint } from './fingerprint'
export { matchElement } from './matcher'
export { AnnotationStorage } from './storage'
export { LocalStorageAdapter } from './local-storage-adapter'
export { detectRemarqPlugin, detectSource } from './source-detect'
export { generateAgentExport } from './agent-export'
