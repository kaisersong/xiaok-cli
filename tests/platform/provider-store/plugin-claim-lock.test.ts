import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PluginClaimLock,
  PluginLockBusyError,
  PluginLockFailClosedError,
  type ClaimLockDeps,
  type ProcessIdentity,
} from '../../../src/platform/provider-store/plugin-claim-lock.js';

/**
 * Design v58 §4.4 / R28-01 / R29-03. The failure this replaces: the v1 stale
 * reclaim (read-dead → rm → create on one shared path) lets two processes both
 * judge a lock dead, so B deletes A's freshly created owner file and becomes a
 * second owner.
 */
describe('PluginClaimLock v2', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function claimsDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'claim-lock-'));
    dirs.push(dir);
    return join(dir, 'locks', 'kai-slide-creator.claims');
  }

  function makeDeps(overrides: Partial<ClaimLockDeps> & { self: () => ProcessIdentity }): ClaimLockDeps {
    const liveByPid = new Map<number, string>();
    return {
      self: overrides.self,
      probeIdentity: overrides.probeIdentity ?? ((pid) => {
        const startIdentity = liveByPid.get(pid);
        return startIdentity ? { pid, startIdentity } : null;
      }),
      now: overrides.now ?? (() => Date.now()),
      sleep: overrides.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    };
  }

  /** Two in-process contenders backed by distinct simulated identities. */
  function twoContenders(dir: string) {
    const alive = new Map<number, string>([[100, 'start-a'], [200, 'start-b']]);
    const probeIdentity = (pid: number) => {
      const startIdentity = alive.get(pid);
      return startIdentity ? { pid, startIdentity } : null;
    };
    const mk = (pid: number, startIdentity: string) => new PluginClaimLock({
      claimsDir: dir,
      acquireTimeoutMs: 2_000,
      pollIntervalMs: 1,
      deps: makeDeps({ self: () => ({ pid, startIdentity }), probeIdentity }),
    });
    return { a: mk(100, 'start-a'), b: mk(200, 'start-b'), alive };
  }

  it('serialises two contenders: the second only enters after the first releases', async () => {
    const dir = claimsDir();
    const { a, b } = twoContenders(dir);
    const order: string[] = [];

    const capA = await a.acquire();
    order.push('a-in');

    let bEntered = false;
    const bRun = b.acquire().then((capB) => {
      bEntered = true;
      order.push('b-in');
      b.release(capB);
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(bEntered).toBe(false);

    a.release(capA);
    order.push('a-out');
    await bRun;

    expect(order).toEqual(['a-in', 'a-out', 'b-in']);
  });

  it('leaves no claim files behind after release', async () => {
    const dir = claimsDir();
    const { a } = twoContenders(dir);

    const cap = await a.acquire();
    expect(readdirSync(dir).length).toBe(1);
    a.release(cap);

    expect(readdirSync(dir)).toEqual([]);
  });

  it('reclaims a dead claim without deleting the live winner (the v1 double-owner bug)', async () => {
    const dir = claimsDir();
    const { a, b, alive } = twoContenders(dir);

    // A holds the lock, then dies without releasing.
    const capA = await a.acquire();
    void capA;
    alive.delete(100);

    // B must be able to take over, and its own claim must survive.
    const capB = await b.acquire();
    const remaining = readdirSync(dir);

    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toContain(capB.token);
    b.release(capB);
  });

  it('treats a reused pid with a different start identity as dead', async () => {
    const dir = claimsDir();
    const alive = new Map<number, string>([[100, 'start-a']]);
    const probeIdentity = (pid: number) => {
      const startIdentity = alive.get(pid);
      return startIdentity ? { pid, startIdentity } : null;
    };
    const first = new PluginClaimLock({
      claimsDir: dir,
      deps: makeDeps({ self: () => ({ pid: 100, startIdentity: 'start-a' }), probeIdentity }),
    });
    const cap = await first.acquire();
    void cap;

    // Same pid, new process: the old claim must not look alive.
    alive.set(100, 'start-recycled');
    const second = new PluginClaimLock({
      claimsDir: dir,
      acquireTimeoutMs: 1_000,
      pollIntervalMs: 1,
      deps: makeDeps({ self: () => ({ pid: 100, startIdentity: 'start-recycled' }), probeIdentity }),
    });

    const capSecond = await second.acquire();
    expect(capSecond.token).toBeTruthy();
    second.release(capSecond);
  });

  it('does not starve a settled owner when newcomers keep arriving', async () => {
    const dir = claimsDir();
    const alive = new Map<number, string>([[100, 'start-a']]);
    for (let pid = 300; pid < 306; pid += 1) alive.set(pid, `start-${pid}`);
    const probeIdentity = (pid: number) => {
      const s = alive.get(pid);
      return s ? { pid, startIdentity: s } : null;
    };
    const owner = new PluginClaimLock({
      claimsDir: dir,
      acquireTimeoutMs: 3_000,
      pollIntervalMs: 1,
      deps: makeDeps({ self: () => ({ pid: 100, startIdentity: 'start-a' }), probeIdentity }),
    });

    const newcomers: Array<Promise<void>> = [];
    const ownerCapPromise = owner.acquire();
    for (let pid = 300; pid < 306; pid += 1) {
      const lock = new PluginClaimLock({
        claimsDir: dir,
        acquireTimeoutMs: 3_000,
        pollIntervalMs: 1,
        deps: makeDeps({ self: () => ({ pid, startIdentity: `start-${pid}` }), probeIdentity }),
      });
      newcomers.push(lock.acquire().then((c) => lock.release(c)));
    }

    const cap = await ownerCapPromise;
    owner.release(cap);
    await Promise.all(newcomers);

    expect(readdirSync(dir)).toEqual([]);
  });

  it('fails closed on a corrupt claim instead of guessing', async () => {
    const dir = claimsDir();
    const { a } = twoContenders(dir);
    a.ensureDirs();
    writeFileSync(join(dir, 'deadbeef.claim'), 'not json\n');

    await expect(a.acquire()).rejects.toThrow(PluginLockFailClosedError);
  });

  it('returns a typed busy error instead of waiting forever', async () => {
    const dir = claimsDir();
    const { a, b } = twoContenders(dir);
    const cap = await a.acquire();

    const impatient = new PluginClaimLock({
      claimsDir: dir,
      acquireTimeoutMs: 20,
      pollIntervalMs: 1,
      deps: makeDeps({
        self: () => ({ pid: 200, startIdentity: 'start-b' }),
        probeIdentity: (pid) => (pid === 100 ? { pid, startIdentity: 'start-a' } : { pid, startIdentity: 'start-b' }),
      }),
    });
    void b;

    await expect(impatient.acquire()).rejects.toThrow(PluginLockBusyError);
    a.release(cap);
  });

  it('withLock releases even when the critical section throws', async () => {
    const dir = claimsDir();
    const { a } = twoContenders(dir);

    await expect(a.withLock(async () => { throw new Error('install failed'); }))
      .rejects.toThrow('install failed');

    expect(readdirSync(dir)).toEqual([]);
  });
});
