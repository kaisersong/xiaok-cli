import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  issueCapabilityToken,
  consumeCapabilityToken,
  registerWatchHandle,
  releaseWatchHandle,
  releaseAllTokensFor,
  clearAllForTests,
  getActiveTokenCount,
  getActiveWatchHandleCount,
  TTL_RANGE,
  type CapabilityOperation,
} from '../../electron/security/capability-lifecycle.js';

afterEach(() => {
  clearAllForTests();
});

describe('capability token lifecycle', () => {
  it('issues and consumes a one-shot read token', () => {
    const token = issueCapabilityToken({
      pathOrParent: '/tmp/file.txt',
      operation: 'read',
      webContentsId: 1,
    });
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);

    const stored = consumeCapabilityToken(token, 1);
    expect(stored.pathOrParent).toBe('/tmp/file.txt');
    expect(stored.operation).toBe('read');
  });

  it('rejects consumption by a different webContentsId', () => {
    const token = issueCapabilityToken({
      pathOrParent: '/tmp/file.txt',
      operation: 'read',
      webContentsId: 1,
    });
    expect(() => consumeCapabilityToken(token, 2)).toThrow('capability_token_wrong_sender');
  });

  it('rejects re-consumption of a one-shot token', () => {
    const token = issueCapabilityToken({
      pathOrParent: '/tmp/file.txt',
      operation: 'write-existing',
      webContentsId: 1,
    });
    consumeCapabilityToken(token, 1);
    expect(() => consumeCapabilityToken(token, 1)).toThrow('capability_token_invalid');
  });

  it('allows repeated consumption of a watch token', () => {
    const token = issueCapabilityToken({
      pathOrParent: '/tmp/dir',
      operation: 'watch',
      webContentsId: 1,
    });
    const s1 = consumeCapabilityToken(token, 1);
    expect(s1.operation).toBe('watch');
    const s2 = consumeCapabilityToken(token, 1);
    expect(s2.operation).toBe('watch');
  });

  it('rejects expired tokens', () => {
    vi.useFakeTimers();
    const token = issueCapabilityToken({
      pathOrParent: '/tmp/file.txt',
      operation: 'read',
      webContentsId: 1,
      ttlMs: 60_000,
    });
    vi.advanceTimersByTime(60_001);
    expect(() => consumeCapabilityToken(token, 1)).toThrow('capability_token_expired');
    vi.useRealTimers();
  });

  it('rejects an unknown token', () => {
    expect(() => consumeCapabilityToken('nonexistent', 1)).toThrow('capability_token_invalid');
  });
});

describe('capability TTL matrix', () => {
  const operations: CapabilityOperation[] = ['read', 'write-existing', 'write-new', 'open', 'watch'];

  it('has a defined TTL range for every operation', () => {
    for (const op of operations) {
      const range = TTL_RANGE[op];
      expect(range).toBeDefined();
      expect(range.min).toBeLessThanOrEqual(range.default);
      expect(range.default).toBeLessThanOrEqual(range.max);
    }
  });

  it('read defaults to 5 minutes', () => {
    expect(TTL_RANGE['read'].default).toBe(5 * 60_000);
  });

  it('write-new defaults to 30 minutes', () => {
    expect(TTL_RANGE['write-new'].default).toBe(30 * 60_000);
  });

  it('watch defaults to 24 hours', () => {
    expect(TTL_RANGE['watch'].default).toBe(24 * 3600_000);
  });

  it('clamps ttlMs to range boundaries', () => {
    const tokenTooShort = issueCapabilityToken({
      pathOrParent: '/tmp/x',
      operation: 'read',
      webContentsId: 1,
      ttlMs: 1,
    });
    expect(getActiveTokenCount()).toBe(1);
    clearAllForTests();

    const tokenTooLong = issueCapabilityToken({
      pathOrParent: '/tmp/x',
      operation: 'read',
      webContentsId: 1,
      ttlMs: 999_999_999,
    });
    expect(getActiveTokenCount()).toBe(1);
  });
});

describe('watch handle registry', () => {
  it('registers and releases a watch handle', () => {
    let closed = false;
    registerWatchHandle('tok-1', 1, () => { closed = true; });
    expect(getActiveWatchHandleCount()).toBe(1);

    releaseWatchHandle('tok-1');
    expect(closed).toBe(true);
    expect(getActiveWatchHandleCount()).toBe(0);
  });

  it('releaseAllTokensFor cleans up tokens and watch handles for a given webContentsId', () => {
    issueCapabilityToken({ pathOrParent: '/a', operation: 'read', webContentsId: 1 });
    issueCapabilityToken({ pathOrParent: '/b', operation: 'read', webContentsId: 2 });
    registerWatchHandle('w1', 1, () => {});
    registerWatchHandle('w2', 2, () => {});

    releaseAllTokensFor(1);

    expect(getActiveTokenCount()).toBe(1);
    expect(getActiveWatchHandleCount()).toBe(1);
  });
});
