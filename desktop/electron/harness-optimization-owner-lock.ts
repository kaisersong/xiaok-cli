import { mkdirSync, realpathSync, statSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function harnessOwnerPlatformQualified(platform: string): boolean { return platform === 'darwin'; }
export interface HarnessOwnerLock { root: string; identity: string; held(): boolean; release(): void }
// The native handle closes its fd (dropping the flock) in its GC finalizer. Pin every live handle here so
// the OS lock is held until release() or process exit, never lost because a caller dropped its reference.
const liveOwnerLockHandles = new Set<unknown>();
export function acquireHarnessOwnerLock(dataRoot: string): HarnessOwnerLock {
  if (!harnessOwnerPlatformQualified(process.platform)) throw new Error('owner_platform_unqualified');
  mkdirSync(dataRoot, { recursive: true });
  const root = realpathSync.native(dataRoot);
  const stat = statSync(root, { bigint: true });
  if (!stat.isDirectory() || stat.ino === 0n) throw new Error('owner_identity_unavailable');
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, 'harness_owner_lock.node'), resolve(here, '../../native/harness-optimization-owner-lock/build/Release/harness_owner_lock.node')];
  const binary = candidates.find(path => existsSync(path));
  if (!binary) throw new Error('owner_lock_unavailable');
  const native = createRequire(import.meta.url)(binary) as { acquire(path: string): unknown; release(handle: unknown): void };
  const handle = native.acquire(join(root, 'harness-optimization.owner.lock'));
  liveOwnerLockHandles.add(handle);
  let held = true;
  return { root, identity: `${stat.dev}:${stat.ino}`, held: () => held,
    release() { if (held) { native.release(handle); held = false; liveOwnerLockHandles.delete(handle); } } };
}
