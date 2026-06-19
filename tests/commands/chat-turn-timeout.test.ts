import { describe, expect, it } from 'vitest';
import {
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
