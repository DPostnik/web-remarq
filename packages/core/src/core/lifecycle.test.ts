import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Annotation, AnnotationStatus } from './types';
import { createEvent, transition, InvalidTransitionError, type LifecycleAction } from './lifecycle';

function makeAnnotation(status: AnnotationStatus): Annotation {
  return {
    id: 'a1',
    comment: 'x',
    route: '/',
    viewport: '1280x720',
    viewportBucket: 1200,
    timestamp: 1_700_000_000_000,
    status,
    lifecycle: [{ type: 'created', actor: 'designer', timestamp: 1_700_000_000_000 }],
    fingerprint: {
      dataAnnotate: null,
      dataTestId: null,
      id: null,
      tagName: 'div',
      textContent: null,
      role: null,
      ariaLabel: null,
      stableClasses: [],
      domPath: '',
      siblingIndex: 0,
      parentAnchor: null,
      sourceLocation: null,
      componentName: null,
      detectedSource: null,
      detectedComponent: null,
    },
  };
}

describe('createEvent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 16, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults timestamp to Date.now()', () => {
    const ev = createEvent('acknowledged');
    expect(ev.timestamp).toBe(Date.now());
  });

  it('uses provided timestamp when given', () => {
    const ev = createEvent('verified', { timestamp: 42 });
    expect(ev.timestamp).toBe(42);
  });

  it('defaults actor by event type — designer for created', () => {
    expect(createEvent('created').actor).toBe('designer');
  });

  it('defaults actor by event type — agent for fix_claimed', () => {
    expect(createEvent('fix_claimed').actor).toBe('agent');
  });

  it('defaults actor by event type — developer for verified', () => {
    expect(createEvent('verified').actor).toBe('developer');
  });

  it('defaults actor to null for migrated', () => {
    expect(createEvent('migrated').actor).toBeNull();
  });

  it('uses provided actor over default', () => {
    expect(createEvent('verified', { actor: 'agent' }).actor).toBe('agent');
  });

  it('includes actorName and reason when provided', () => {
    const ev = createEvent('rejected', { actorName: 'Alice', reason: 'still broken' });
    expect(ev.actorName).toBe('Alice');
    expect(ev.reason).toBe('still broken');
  });

  it('omits optional fields when not provided', () => {
    const ev = createEvent('verified');
    expect('actorName' in ev).toBe(false);
    expect('reason' in ev).toBe(false);
  });
});

describe('transition — valid transitions', () => {
  const cases: Array<[AnnotationStatus, LifecycleAction, AnnotationStatus, string]> = [
    ['pending', 'acknowledge', 'in_progress', 'acknowledged'],
    ['pending', 'claimFix', 'fixed_unverified', 'fix_claimed'],
    ['pending', 'dismiss', 'dismissed', 'dismissed'],
    ['in_progress', 'claimFix', 'fixed_unverified', 'fix_claimed'],
    ['in_progress', 'verify', 'verified', 'verified'],
    ['in_progress', 'dismiss', 'dismissed', 'dismissed'],
    ['fixed_unverified', 'verify', 'verified', 'verified'],
    ['fixed_unverified', 'reject', 'pending', 'rejected'],
    ['fixed_unverified', 'dismiss', 'dismissed', 'dismissed'],
    ['verified', 'reopen', 'pending', 'reopened'],
    ['dismissed', 'reopen', 'pending', 'reopened'],
  ];

  for (const [from, action, expectedStatus, expectedEventType] of cases) {
    it(`${from} + ${action} → ${expectedStatus} (event: ${expectedEventType})`, () => {
      const ann = makeAnnotation(from);
      const result = transition(ann, action);
      expect(result.status).toBe(expectedStatus);
      expect(result.event.type).toBe(expectedEventType);
    });
  }
});

describe('transition — invalid transitions throw', () => {
  const invalid: Array<[AnnotationStatus, LifecycleAction]> = [
    ['pending', 'verify'],
    ['pending', 'reject'],
    ['pending', 'reopen'],
    ['in_progress', 'acknowledge'],
    ['in_progress', 'reject'],
    ['in_progress', 'reopen'],
    ['fixed_unverified', 'acknowledge'],
    ['fixed_unverified', 'claimFix'],
    ['fixed_unverified', 'reopen'],
    ['verified', 'acknowledge'],
    ['verified', 'claimFix'],
    ['verified', 'verify'],
    ['verified', 'reject'],
    ['verified', 'dismiss'],
    ['dismissed', 'acknowledge'],
    ['dismissed', 'claimFix'],
    ['dismissed', 'verify'],
    ['dismissed', 'reject'],
    ['dismissed', 'dismiss'],
  ];

  for (const [from, action] of invalid) {
    it(`throws InvalidTransitionError on ${from} + ${action}`, () => {
      const ann = makeAnnotation(from);
      expect(() => transition(ann, action)).toThrowError(InvalidTransitionError);
    });
  }
});

describe('transition — reject from fixed_unverified', () => {
  it('returns status pending and event type rejected with reason', () => {
    const ann = makeAnnotation('fixed_unverified');
    const result = transition(ann, 'reject', { reason: 'broken on mobile' });
    expect(result.status).toBe('pending');
    expect(result.event.type).toBe('rejected');
    expect(result.event.reason).toBe('broken on mobile');
    expect(result.event.actor).toBe('developer');
  });
});

describe('transition — reopen', () => {
  it('dismissed → pending', () => {
    const ann = makeAnnotation('dismissed');
    const result = transition(ann, 'reopen');
    expect(result.status).toBe('pending');
    expect(result.event.type).toBe('reopened');
  });

  it('verified → pending', () => {
    const ann = makeAnnotation('verified');
    const result = transition(ann, 'reopen');
    expect(result.status).toBe('pending');
    expect(result.event.type).toBe('reopened');
  });
});
