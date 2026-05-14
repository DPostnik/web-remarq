import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { destroyViewportListener, initViewportListener, toBucket } from './viewport';

describe('toBucket', () => {
  it('rounds width down to the nearest 100px', () => {
    expect(toBucket(0)).toBe(0);
    expect(toBucket(50)).toBe(0);
    expect(toBucket(99)).toBe(0);
    expect(toBucket(100)).toBe(100);
    expect(toBucket(150)).toBe(100);
    expect(toBucket(199)).toBe(100);
    expect(toBucket(1280)).toBe(1200);
    expect(toBucket(1440)).toBe(1400);
    expect(toBucket(1920)).toBe(1900);
  });

  it('keeps exact 100-multiples', () => {
    expect(toBucket(800)).toBe(800);
    expect(toBucket(2000)).toBe(2000);
  });
});

describe('initViewportListener / destroyViewportListener', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    destroyViewportListener();
    vi.useRealTimers();
  });

  function setWindowWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: width,
    });
  }

  it('does not invoke callback synchronously on init', () => {
    setWindowWidth(1280);
    const cb = vi.fn();
    initViewportListener(cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it('invokes callback once per debounce window when bucket changes', () => {
    setWindowWidth(1280);
    const cb = vi.fn();
    initViewportListener(cb);

    setWindowWidth(1440);
    window.dispatchEvent(new Event('resize'));
    expect(cb).not.toHaveBeenCalled(); // still inside debounce

    vi.advanceTimersByTime(300);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not fire when resize stays in the same bucket', () => {
    setWindowWidth(1280);
    const cb = vi.fn();
    initViewportListener(cb);

    setWindowWidth(1299); // still bucket 1200
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(300);

    expect(cb).not.toHaveBeenCalled();
  });

  it('debounces rapid resize events into a single callback', () => {
    setWindowWidth(1280);
    const cb = vi.fn();
    initViewportListener(cb);

    setWindowWidth(1440);
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(100);
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(100);
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(300);

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('stops invoking callback after destroyViewportListener', () => {
    setWindowWidth(1280);
    const cb = vi.fn();
    initViewportListener(cb);
    destroyViewportListener();

    setWindowWidth(1920);
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(300);

    expect(cb).not.toHaveBeenCalled();
  });
});
