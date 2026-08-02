import { describe, expect, it, vi } from 'vitest';
import {
  createTurnActivityWatchdog,
  DEFAULT_TURN_TIMEOUT_MS,
  resolveTurnTimeoutMs,
} from '../../src/commands/chat-runtime-config.js';

describe('resolveTurnTimeoutMs', () => {
  it('returns the default when no env override is provided', () => {
    expect(resolveTurnTimeoutMs({})).toBe(DEFAULT_TURN_TIMEOUT_MS);
  });

  it('honors a positive integer override', () => {
    expect(resolveTurnTimeoutMs({ XIAOK_TURN_TIMEOUT_MS: '60000' })).toBe(60000);
  });

  it('floors fractional positive overrides', () => {
    expect(resolveTurnTimeoutMs({ XIAOK_TURN_TIMEOUT_MS: '12.9' })).toBe(12);
  });

  it('falls back to default for non-numeric values', () => {
    expect(resolveTurnTimeoutMs({ XIAOK_TURN_TIMEOUT_MS: 'bad' }))
      .toBe(DEFAULT_TURN_TIMEOUT_MS);
  });

  it('falls back to default for empty string', () => {
    expect(resolveTurnTimeoutMs({ XIAOK_TURN_TIMEOUT_MS: '' }))
      .toBe(DEFAULT_TURN_TIMEOUT_MS);
  });

  it('returns null to opt out when value is zero', () => {
    expect(resolveTurnTimeoutMs({ XIAOK_TURN_TIMEOUT_MS: '0' })).toBeNull();
  });

  it('returns null to opt out when value is negative', () => {
    expect(resolveTurnTimeoutMs({ XIAOK_TURN_TIMEOUT_MS: '-1' })).toBeNull();
  });
});

describe('createTurnActivityWatchdog', () => {
  it('aborts only after a full idle window', () => {
    vi.useFakeTimers();
    try {
      const watchdog = createTurnActivityWatchdog(1_000);

      vi.advanceTimersByTime(900);
      watchdog.noteActivity();
      vi.advanceTimersByTime(900);

      expect(watchdog.signal.aborted).toBe(false);
      expect(watchdog.didTimeout()).toBe(false);

      vi.advanceTimersByTime(100);

      expect(watchdog.signal.aborted).toBe(true);
      expect(watchdog.didTimeout()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays disabled when timeout is null', () => {
    vi.useFakeTimers();
    try {
      const watchdog = createTurnActivityWatchdog(null);

      vi.advanceTimersByTime(DEFAULT_TURN_TIMEOUT_MS * 2);

      expect(watchdog.signal.aborted).toBe(false);
      expect(watchdog.didTimeout()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('dispose prevents a later timeout', () => {
    vi.useFakeTimers();
    try {
      const watchdog = createTurnActivityWatchdog(1_000);
      watchdog.dispose();

      vi.advanceTimersByTime(1_000);

      expect(watchdog.signal.aborted).toBe(false);
      expect(watchdog.didTimeout()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
