import type {
  Annotation,
  AnnotationEvent,
  AnnotationEventType,
  AnnotationStatus,
  Actor,
} from './types'

export type LifecycleAction =
  | 'acknowledge'
  | 'claimFix'
  | 'verify'
  | 'reject'
  | 'dismiss'
  | 'reopen'

export class InvalidTransitionError extends Error {
  constructor(from: AnnotationStatus, action: LifecycleAction) {
    super(`Cannot ${action} from status "${from}"`)
    this.name = 'InvalidTransitionError'
  }
}

export interface EventOpts {
  actor?: Actor
  actorName?: string
  reason?: string
  timestamp?: number
}

const ACTION_TO_EVENT: Record<LifecycleAction, AnnotationEventType> = {
  acknowledge: 'acknowledged',
  claimFix: 'fix_claimed',
  verify: 'verified',
  reject: 'rejected',
  dismiss: 'dismissed',
  reopen: 'reopened',
}

const DEFAULT_ACTOR_BY_EVENT: Record<AnnotationEventType, Actor | null> = {
  created: 'designer',
  acknowledged: 'developer',
  fix_claimed: 'agent',
  verified: 'developer',
  rejected: 'developer',
  dismissed: 'developer',
  reopened: 'developer',
  migrated: null,
}

export function createEvent(type: AnnotationEventType, opts: EventOpts = {}): AnnotationEvent {
  const event: AnnotationEvent = {
    type,
    actor: opts.actor ?? DEFAULT_ACTOR_BY_EVENT[type],
    timestamp: opts.timestamp ?? Date.now(),
  }
  if (opts.actorName !== undefined) event.actorName = opts.actorName
  if (opts.reason !== undefined) event.reason = opts.reason
  return event
}

function nextStatus(
  from: AnnotationStatus,
  action: LifecycleAction,
): AnnotationStatus | null {
  switch (action) {
    case 'acknowledge':
      return from === 'pending' ? 'in_progress' : null
    case 'claimFix':
      return from === 'pending' || from === 'in_progress' ? 'fixed_unverified' : null
    case 'verify':
      return from === 'fixed_unverified' || from === 'in_progress' ? 'verified' : null
    case 'reject':
      return from === 'fixed_unverified' ? 'pending' : null
    case 'dismiss':
      return from === 'pending' || from === 'in_progress' || from === 'fixed_unverified'
        ? 'dismissed'
        : null
    case 'reopen':
      return from === 'dismissed' || from === 'verified' ? 'pending' : null
  }
}

export function transition(
  annotation: Annotation,
  action: LifecycleAction,
  opts: EventOpts = {},
): { status: AnnotationStatus; event: AnnotationEvent } {
  const next = nextStatus(annotation.status, action)
  if (next === null) {
    throw new InvalidTransitionError(annotation.status, action)
  }
  const event = createEvent(ACTION_TO_EVENT[action], opts)
  return { status: next, event }
}
