import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  authoriseDestructiveMutation,
  DESTRUCTIVE_SITES,
  MissingLockCapabilityError,
  planUninstall,
} from '../../../src/platform/provider-store/destructive-site-guard.js';
import { ProviderSourcePin } from '../../../src/platform/provider-store/provider-source-pin.js';
import type { PluginLockCapability, ProcessIdentity } from '../../../src/platform/provider-store/plugin-claim-lock.js';

/**
 * Design v58 §4.4 / R28-02: guarding only the pruner still lets stage /
 * dependency-runtime / installer-catch delete a digest that a live provider child
 * is executing. All five sites must share one capability and re-read pins inside
 * the lock.
 */
describe('destructive site guard', () => {
  const dirs: string[] = [];
  const PLUGIN = 'kai-slide-creator';
  const DIGEST = 'sha256-aaa';
  const MAIN: ProcessIdentity = { pid: 777, startIdentity: 'main-start' };
  const CAP: PluginLockCapability = { token: 'tok', ticket: 1, claimsDir: '/tmp/claims' };

  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function pinsRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'destructive-'));
    dirs.push(dir);
    return join(dir, 'pins');
  }

  const alive = (...ids: ProcessIdentity[]) => (pid: number) => ids.find((i) => i.pid === pid) ?? null;

  function pinnedRoot(): string {
    const root = pinsRoot();
    new ProviderSourcePin(
      root,
      { pluginName: PLUGIN, sourceDigest: DIGEST, sourceSnapshotPath: '/store/repo' },
      'inst-1',
      () => MAIN,
    ).acquireMain();
    return root;
  }

  it('requires the lock capability at every destructive site', () => {
    const root = pinsRoot();
    for (const site of DESTRUCTIVE_SITES) {
      expect(() => authoriseDestructiveMutation({
        site,
        capability: null,
        pinsRoot: root,
        pluginName: PLUGIN,
        sourceDigest: DIGEST,
        probeIdentity: alive(),
      })).toThrow(MissingLockCapabilityError);
    }
  });

  it('allows deletion when nothing pins the digest', () => {
    const root = pinsRoot();

    for (const site of DESTRUCTIVE_SITES) {
      expect(authoriseDestructiveMutation({
        site,
        capability: CAP,
        pinsRoot: root,
        pluginName: PLUGIN,
        sourceDigest: DIGEST,
        probeIdentity: alive(),
      })).toEqual({ kind: 'proceed' });
    }
  });

  it('refuses every site while a live process pins the digest', () => {
    const root = pinnedRoot();

    for (const site of DESTRUCTIVE_SITES) {
      const decision = authoriseDestructiveMutation({
        site,
        capability: CAP,
        pinsRoot: root,
        pluginName: PLUGIN,
        sourceDigest: DIGEST,
        probeIdentity: alive(MAIN),
      });
      expect(decision.kind).toBe('version_in_use');
    }
  });

  it('reuses a live-pinned digest read-only when its content re-verifies', () => {
    const root = pinnedRoot();

    const decision = authoriseDestructiveMutation({
      site: 'stage_pre_clean',
      capability: CAP,
      pinsRoot: root,
      pluginName: PLUGIN,
      sourceDigest: DIGEST,
      reVerifies: true,
      probeIdentity: alive(MAIN),
    });

    expect(decision).toEqual({ kind: 'reuse_readonly', reason: 'digest_live_pinned_and_verified' });
  });

  it('never lets --force overwrite a live-pinned digest in place', () => {
    const root = pinnedRoot();

    const decision = authoriseDestructiveMutation({
      site: 'stage_pre_clean',
      capability: CAP,
      pinsRoot: root,
      pluginName: PLUGIN,
      sourceDigest: DIGEST,
      reVerifies: true,
      force: true,
      probeIdentity: alive(MAIN),
    });

    expect(decision.kind).toBe('version_in_use');
  });

  it('keeps a crashed host with an unresolved launch ref undeletable', () => {
    const root = pinsRoot();
    const pin = new ProviderSourcePin(
      root,
      { pluginName: PLUGIN, sourceDigest: DIGEST, sourceSnapshotPath: '/store/repo' },
      'inst-1',
      () => MAIN,
    );
    pin.acquireMain();
    pin.beginLaunch('launch-1'); // starting fsynced, host then dies

    const decision = authoriseDestructiveMutation({
      site: 'pointer_switch_prune',
      capability: CAP,
      pinsRoot: root,
      pluginName: PLUGIN,
      sourceDigest: DIGEST,
      probeIdentity: alive(), // nobody alive
    });

    expect(decision.kind).toBe('version_in_use');
  });

  it('uninstall removes the pointer immediately but defers physical deletion', () => {
    const root = pinnedRoot();

    const plan = planUninstall({
      capability: CAP,
      pinsRoot: root,
      pluginName: PLUGIN,
      sourceDigest: DIGEST,
      probeIdentity: alive(MAIN),
    });

    expect(plan.removePointerNow).toBe(true);
    expect(plan.deletePhysicallyNow).toBe(false);
    expect(plan.deferReason).toMatch(/version_in_use/);
  });

  it('uninstall deletes immediately once the pin is gone', () => {
    const root = pinsRoot();

    expect(planUninstall({
      capability: CAP,
      pinsRoot: root,
      pluginName: PLUGIN,
      sourceDigest: DIGEST,
      probeIdentity: alive(),
    })).toEqual({ removePointerNow: true, deletePhysicallyNow: true });
  });

  it('enumerates exactly the five design-named destructive surfaces (plus their exception paths)', () => {
    expect([...DESTRUCTIVE_SITES]).toEqual([
      'stage_pre_clean',
      'stage_exception_cleanup',
      'dependency_runtime_pre_clean',
      'dependency_runtime_exception_cleanup',
      'installer_catch_cleanup',
      'pointer_switch_prune',
      'uninstall',
    ]);
  });
});
