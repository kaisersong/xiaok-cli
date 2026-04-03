import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { PidLock } from '../../src/utils/pid-lock.js';

describe('PidLock', () => {
  const dir = join(tmpdir(), `xiaok-pidlock-${Date.now()}`);
  const pidFile = join(dir, 'test.pid');

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('acquires lock and writes current pid', () => {
    const lock = new PidLock(pidFile);
    const result = lock.acquire();

    expect(result.acquired).toBe(true);
    expect(existsSync(pidFile)).toBe(true);
    expect(readFileSync(pidFile, 'utf-8').trim()).toBe(String(process.pid));

    lock.release();
  });

  it('refuses if another live process holds the lock', () => {
    const lock1 = new PidLock(pidFile);
    lock1.acquire();

    const lock2 = new PidLock(pidFile);
    const result = lock2.acquire();

    expect(result.acquired).toBe(false);
    expect(result.existingPid).toBe(process.pid);

    lock1.release();
  });

  it('acquires if pidfile exists but process is dead (stale)', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(pidFile, '999999', 'utf-8');

    const lock = new PidLock(pidFile);
    const result = lock.acquire();

    expect(result.acquired).toBe(true);

    lock.release();
  });

  it('release only removes pidfile if pid matches', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(pidFile, '12345', 'utf-8');

    const lock = new PidLock(pidFile);
    lock.release();

    // Should not have been deleted since pid doesn't match
    expect(existsSync(pidFile)).toBe(true);
  });
});
