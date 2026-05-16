export type {
  Annotation,
  AnnotationStatus,
  AnnotationEvent,
  AnnotationEventType,
  Actor,
  AnnotationStore,
  ElementFingerprint,
  CSSModuleClass,
  SourceDetectionResult,
  SearchConfidence,
  GrepQuery,
  AgentSearchHints,
  AgentAnnotationSource,
  AgentAnnotation,
  AgentLifecycleEvent,
  AgentExport,
  ToolbarPosition,
  StorageAdapter,
  StorageChangeEvent,
} from './types'
export { createFingerprint } from './fingerprint'
export { matchElement } from './matcher'
export { AnnotationStorage, migrateAnnotation } from './storage'
export { LocalStorageAdapter } from './local-storage-adapter'
export { detectRemarqPlugin, detectSource } from './source-detect'
export { generateAgentExport } from './agent-export'
export { transition, createEvent, InvalidTransitionError } from './lifecycle'
export type { LifecycleAction, EventOpts } from './lifecycle'
