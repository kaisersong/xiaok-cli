import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GoalSessionLease } from '../../../src/runtime/goal/index.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('GoalSessionLease', () => {
  it('prevents a second live instance from acquiring the same session lease', () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-goal-lease-'));
    roots.push(root);
    const first = new GoalSessionLease({ rootDir: root, sessionId: 'sess_1', instanceId: 'one' });
    const second = new GoalSessionLease({ rootDir: root, sessionId: 'sess_1', instanceId: 'two' });
    first.acquire();
    expect(() => second.acquire()).toThrow(/lease/i);
    first.release();
    expect(() => second.acquire()).not.toThrow();
    second.release();
  });

  it('allows explicit recovery of an expired dead lease but never a live lease', () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-goal-lease-'));
    roots.push(root);
    const first = new GoalSessionLease({
      rootDir: root, sessionId: 'sess_1', instanceId: 'one', pid: 999_999_999,
      now: () => 0, leaseTimeoutMs: 10,
    });
    first.acquire();
    const second = new GoalSessionLease({
      rootDir: root, sessionId: 'sess_1', instanceId: 'two', now: () => 20,
      isProcessAlive: () => false, leaseTimeoutMs: 10,
    });
    expect(() => second.acquire()).toThrow(/lease/i);
    expect(() => second.acquire({ recoverExpired: true })).not.toThrow();
    second.release();
  });
});
