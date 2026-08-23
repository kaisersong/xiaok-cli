import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isSourceDeletable,
  PinFailClosedError,
  ProviderSourcePin,
  recordMainOwnerDead,
  reducePinState,
  type PreSpawnFailureEvidence,
} from '../../../src/platform/provider-store/provider-source-pin.js';
import type { ProcessIdentity } from '../../../src/platform/provider-store/plugin-claim-lock.js';

/**
 * Design v58 §4.4 / R29-02 / R30-01 / R32-02 / R33-01. The reducer below is the
 * production one; these tests never re-implement the state machine.
 */
describe('provider source pin journals', () => {
  const dirs: string[] = [];
  const PLUGIN = 'kai-slide-creator';
  const DIGEST = 'sha256-abc';

  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function pinsRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'provider-pin-'));
    dirs.push(dir);
    return join(dir, 'pins');
  }

  const MAIN: ProcessIdentity = { pid: 4242, startIdentity: 'main-start' };
  const CHILD: ProcessIdentity = { pid: 5150, startIdentity: 'child-start' };

  function aliveOnly(...identities: ProcessIdentity[]) {
    return (pid: number): ProcessIdentity | null =>
      identities.find((i) => i.pid === pid) ?? null;
  }

  function makePin(root: string, instanceId = 'inst-1', self: ProcessIdentity = MAIN) {
    return new ProviderSourcePin(
      root,
      { pluginName: PLUGIN, sourceDigest: DIGEST, sourceSnapshotPath: '/store/repo' },
      instanceId,
      () => self,
    );
  }

  it('keeps the source in use while the main owner is alive', () => {
    const root = pinsRoot();
    makePin(root).acquireMain();

    const verdicts = reducePinState(root, PLUGIN, DIGEST, aliveOnly(MAIN));

    expect(verdicts).toEqual([{ kind: 'in_use', instanceId: 'inst-1', reason: 'main_owner_live', detail: [] }]);
    expect(isSourceDeletable(verdicts)).toBe(false);
  });

  it('becomes deletable only after an explicit main release', () => {
    const root = pinsRoot();
    const pin = makePin(root);
    pin.acquireMain();

    expect(pin.releaseMain('normal_shutdown')).toEqual({ released: true });

    expect(isSourceDeletable(reducePinState(root, PLUGIN, DIGEST, aliveOnly(MAIN)))).toBe(true);
  });

  it('refuses to release main while a launch ref is still open', () => {
    const root = pinsRoot();
    const pin = makePin(root);
    pin.acquireMain();
    const ref = pin.beginLaunch('launch-1');
    ref.markSpawned(CHILD);

    expect(pin.releaseMain('normal_shutdown')).toEqual({ released: false, blockedBy: ['launch-1'] });

    ref.release('process tree empty');
    expect(pin.releaseMain('normal_shutdown')).toEqual({ released: true });
  });

  it('fails closed at the spawn crash window: starting with no spawned event', () => {
    const root = pinsRoot();
    const pin = makePin(root);
    pin.acquireMain();
    pin.beginLaunch('launch-1'); // 000-starting fsynced, then the host "dies"

    // A later process sees a dead main owner but an unresolved ref.
    const verdicts = reducePinState(root, PLUGIN, DIGEST, aliveOnly());

    expect(verdicts).toEqual([
      { kind: 'in_use', instanceId: 'inst-1', reason: 'open_refs', detail: ['launch-1:starting'] },
    ]);
    expect(isSourceDeletable(verdicts)).toBe(false);
  });

  it('reports a live child as in use even when the main owner is gone', () => {
    const root = pinsRoot();
    const pin = makePin(root);
    pin.acquireMain();
    pin.beginLaunch('launch-1').markSpawned(CHILD);

    const verdicts = reducePinState(root, PLUGIN, DIGEST, aliveOnly(CHILD));

    expect(verdicts).toEqual([
      { kind: 'in_use', instanceId: 'inst-1', reason: 'open_refs', detail: ['launch-1:live_child'] },
    ]);
  });

  it('keeps an orphaned ref in use until an explicit diagnosis closes it', () => {
    const root = pinsRoot();
    const pin = makePin(root);
    pin.acquireMain();
    const ref = pin.beginLaunch('launch-1');
    ref.markSpawned(CHILD);
    ref.markOrphaned('descendant tree unknown');

    const verdicts = reducePinState(root, PLUGIN, DIGEST, aliveOnly());

    expect(verdicts[0]).toMatchObject({ kind: 'in_use', reason: 'open_refs', detail: ['launch-1:orphaned'] });
  });

  it('needs an observation event before a dead main owner becomes inactive', () => {
    const root = pinsRoot();
    makePin(root).acquireMain();

    const before = reducePinState(root, PLUGIN, DIGEST, aliveOnly());
    expect(before[0]).toMatchObject({ reason: 'main_owner_dead_needs_observation' });

    recordMainOwnerDead(root, PLUGIN, DIGEST, 'inst-1', 'pid 4242 start identity mismatch');

    expect(isSourceDeletable(reducePinState(root, PLUGIN, DIGEST, aliveOnly()))).toBe(true);
  });

  it('two concurrent launches never lose each other (per-launch journals)', () => {
    const root = pinsRoot();
    const pin = makePin(root);
    pin.acquireMain();
    const first = pin.beginLaunch('launch-1');
    const second = pin.beginLaunch('launch-2');
    first.markSpawned({ pid: 6001, startIdentity: 's1' });
    second.markSpawned({ pid: 6002, startIdentity: 's2' });

    // Interleave: close the first while the second is still spawning.
    first.release('tree empty');
    const verdicts = reducePinState(root, PLUGIN, DIGEST, aliveOnly({ pid: 6002, startIdentity: 's2' }));

    expect(verdicts[0]).toMatchObject({ detail: ['launch-2:live_child'] });

    second.release('tree empty');
    expect(pin.releaseMain('normal_shutdown')).toEqual({ released: true });
    expect(isSourceDeletable(reducePinState(root, PLUGIN, DIGEST, aliveOnly()))).toBe(true);
  });

  it('is idempotent for a byte-identical repeated append', () => {
    const root = pinsRoot();
    const pin = makePin(root);
    pin.acquireMain();
    pin.acquireMain();

    const path = join(root, PLUGIN, DIGEST, 'inst-1', 'owners', 'main', '000-acquired.json');
    const contents = readFileSync(path, 'utf8');
    expect(contents.trim().endsWith('}')).toBe(true);
    expect(reducePinState(root, PLUGIN, DIGEST, aliveOnly(MAIN))).toHaveLength(1);
  });

  it('fails closed when the same event exists with different content', () => {
    const root = pinsRoot();
    makePin(root).acquireMain();
    const other = makePin(root, 'inst-1', { pid: 9999, startIdentity: 'different' });

    expect(() => other.acquireMain()).toThrow(PinFailClosedError);
  });

  it('fails closed on a tampered checksum', () => {
    const root = pinsRoot();
    makePin(root).acquireMain();
    const path = join(root, PLUGIN, DIGEST, 'inst-1', 'owners', 'main', '000-acquired.json');
    const payload = JSON.parse(readFileSync(path, 'utf8'));
    payload.pid = 1;
    writeFileSync(path, `${JSON.stringify(payload)}\n`);

    expect(() => reducePinState(root, PLUGIN, DIGEST, aliveOnly(MAIN))).toThrow(/checksum_mismatch/);
  });

  it('accepts 090-not-created only with complete pre-spawn evidence', () => {
    const root = pinsRoot();
    const pin = makePin(root);
    pin.acquireMain();
    const ref = pin.beginLaunch('launch-1');
    const complete: PreSpawnFailureEvidence = {
      spawnObserved: false,
      everHadPid: false,
      exitObserved: false,
      errorCode: 'ENOENT',
      errno: -2,
      syscall: 'spawn /store/repo/bin/python3.11',
      path: '/store/repo/bin/python3.11',
      spawnargs: ['/store/repo/bin/python3.11', '-I'],
      closeCode: -2,
      closeSignal: null,
    };

    // Windows synthesises ENOENT for a process that really started: the close
    // code no longer matches the errno, so the evidence must be rejected.
    const synthetic = { ...complete, closeCode: 1 };
    expect(() => ref.markNotCreated(synthetic)).toThrow(/incomplete_pre_spawn_evidence/);

    ref.markNotCreated(complete);
    expect(pin.releaseMain('normal_shutdown')).toEqual({ released: true });
  });
});
