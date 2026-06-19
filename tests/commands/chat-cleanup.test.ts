import { describe, expect, it, vi } from 'vitest';
import { runCleanupWithTimeout } from '../../src/commands/chat-runtime-config.js';

describe('runCleanupWithTimeout', () => {
  it('runs all steps to completion when none hang', async () => {
    const calls: string[] = [];
    await runCleanupWithTimeout(
      [
        async () => { calls.push('a'); },
        async () => { calls.push('b'); },
        () => { calls.push('c'); },
      ],
      500,
    );
    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('resolves within the timeout window if a step hangs', async () => {
    const start = Date.now();
    await runCleanupWithTimeout(
      [
        async () => { /* fast */ },
        () => new Promise<void>(() => { /* never resolves */ }),
        async () => { /* should never run */ throw new Error('should not reach'); },
      ],
      80,
    );
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
    expect(elapsed).toBeGreaterThanOrEqual(60);
  });

  it('continues to next step and reports errors via onError when a step throws', async () => {
    const errors: unknown[] = [];
    const calls: string[] = [];
    await runCleanupWithTimeout(
      [
        async () => { throw new Error('boom'); },
        async () => { calls.push('after'); },
      ],
      500,
      (err) => errors.push(err),
    );
    expect(calls).toEqual(['after']);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('boom');
  });

  it('uses the default timeout when none is provided', async () => {
    vi.useFakeTimers();
    try {
      const cleanupPromise = runCleanupWithTimeout([
        () => new Promise<void>(() => { /* hangs forever */ }),
      ]);
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(cleanupPromise).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
