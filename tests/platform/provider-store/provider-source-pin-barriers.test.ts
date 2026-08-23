import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isSourceDeletable,
  reducePinState,
} from '../../../src/platform/provider-store/provider-source-pin.js';
import { probeIdentityOrFailClosed } from '../../../src/platform/provider-store/process-identity.js';

/**
 * Design v58 §4.4 / R30-01: the spawn crash window must be provable across
 * processes, not just in-process. A real child host is hard-killed (SIGKILL,
 * no cleanup possible) at each barrier point, and a *separate* process then runs
 * the production reducer over the on-disk journals.
 */
describe('provider source pin cross-process barriers', () => {
  const dirs: string[] = [];
  const PLUGIN = 'kai-slide-creator';
  const DIGEST = 'sha256-abc';

  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function scratch(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pin-barrier-'));
    dirs.push(dir);
    return dir;
  }

  /**
   * Runs a host in a real child process. `stopAfter` decides where it hard-kills
   * itself: 'starting' (between the fsynced starting event and spawn) or
   * 'spawned' (after recording the child identity).
   */
  function runHostAndHardKill(root: string, stopAfter: 'starting' | 'spawned'): { pid: number } {
    const script = join(scratch(), 'host.mjs');
    const tsxLoader = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'loader.mjs');
    writeFileSync(script, `
import { ProviderSourcePin } from '${join(process.cwd(), 'src/platform/provider-store/provider-source-pin.ts').replace(/\\\\/g, '/')}';
const self = { pid: process.pid, startIdentity: 'host-' + process.pid };
const pin = new ProviderSourcePin(
  ${JSON.stringify(root)},
  { pluginName: ${JSON.stringify(PLUGIN)}, sourceDigest: ${JSON.stringify(DIGEST)}, sourceSnapshotPath: '/store/repo' },
  'inst-' + process.pid,
  () => self,
);
pin.acquireMain();
const ref = pin.beginLaunch('launch-1');
if (${JSON.stringify(stopAfter)} === 'spawned') {
  ref.markSpawned({ pid: process.pid, startIdentity: self.startIdentity });
}
process.stdout.write(JSON.stringify({ pid: process.pid }) + '\\n');
// Hard kill: no finally, no release, exactly like a crashed host.
process.kill(process.pid, 'SIGKILL');
setInterval(() => {}, 50);
`);
    const result = spawnSync(process.execPath, ['--import', `file://${tsxLoader}`, script], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    const line = (result.stdout ?? '').trim().split('\n').filter(Boolean).pop() ?? '{}';
    const parsed = JSON.parse(line) as { pid?: number };
    if (typeof parsed.pid !== 'number') {
      throw new Error(`host did not report a pid: ${result.stdout} ${result.stderr}`);
    }
    return { pid: parsed.pid };
  }

  it('a host killed between starting and spawn leaves the source undeletable', () => {
    const root = join(scratch(), 'pins');

    const { pid } = runHostAndHardKill(root, 'starting');
    // The host is really gone: its identity must not resolve as alive.
    expect(probeIdentityOrFailClosed(pid)).toBeNull();

    const verdicts = reducePinState(root, PLUGIN, DIGEST, probeIdentityOrFailClosed);

    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({ kind: 'in_use', reason: 'open_refs' });
    expect((verdicts[0] as { detail: string[] }).detail).toEqual(['launch-1:starting']);
    expect(isSourceDeletable(verdicts)).toBe(false);
  }, 90_000);

  it('a host killed after recording the child leaves an unverified tree, not a clean slate', () => {
    const root = join(scratch(), 'pins');

    const { pid } = runHostAndHardKill(root, 'spawned');
    expect(probeIdentityOrFailClosed(pid)).toBeNull();

    const verdicts = reducePinState(root, PLUGIN, DIGEST, probeIdentityOrFailClosed);

    expect(verdicts[0]).toMatchObject({ kind: 'in_use', reason: 'open_refs' });
    expect((verdicts[0] as { detail: string[] }).detail).toEqual(['launch-1:unverified_tree']);
    expect(isSourceDeletable(verdicts)).toBe(false);
  }, 90_000);

  it('two crashed hosts are both reported, so a pruner cannot pick one arbitrarily', () => {
    const root = join(scratch(), 'pins');

    runHostAndHardKill(root, 'starting');
    runHostAndHardKill(root, 'spawned');

    const verdicts = reducePinState(root, PLUGIN, DIGEST, probeIdentityOrFailClosed);

    expect(verdicts).toHaveLength(2);
    expect(verdicts.every((v) => v.kind === 'in_use')).toBe(true);
    expect(isSourceDeletable(verdicts)).toBe(false);
  }, 120_000);
});
