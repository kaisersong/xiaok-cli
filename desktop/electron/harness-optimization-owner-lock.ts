import { mkdirSync, realpathSync, statSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function harnessOwnerPlatformQualified(platform: string): boolean { return platform === 'darwin'; }
export interface HarnessOwnerLock { root: string; identity: string; held(): boolean; release(): void }
// The native handle closes its fd (dropping the flock) in its GC finalizer. Pin every live handle here so
// the OS lock is held until release() or process exit, never lost because a caller dropped its reference.
const liveOwnerLockHandles = new Set<unknown>();
const originalOwnerLocks = new WeakMap<object, Readonly<{ root: string; identity: string; assertLocal(): void }>>();
const ownerLockGet = WeakMap.prototype.get, ownerLockSet = WeakMap.prototype.set, ownerApply = Reflect.apply;
const ownerDescriptor = Object.getOwnPropertyDescriptor, ownerHasOwn = Object.hasOwn, ownerSetHas = Set.prototype.has;
/** Original native acquisition membership only; no file/DB or execution grant. */
export function readOriginalHarnessOwnerLock(candidate: unknown): Readonly<{ root: string; identity: string; assertLocal(): void }> {
  const row = readOptionalOriginalHarnessOwnerLock(candidate);
  if (!row) throw new Error('original_owner_lock_required');
  return row;
}
/** A nonmember is absent; an invalid original is never a legacy fallback. */
export function readOptionalOriginalHarnessOwnerLock(candidate: unknown): Readonly<{ root: string; identity: string; assertLocal(): void }> | null {
  const row = candidate !== null && (typeof candidate === 'object' || typeof candidate === 'function')
    ? ownerApply(ownerLockGet, originalOwnerLocks, [candidate]) as Readonly<{ root: string; identity: string; assertLocal(): void }> | undefined
    : undefined;
  if (!row) return null;
  row.assertLocal();
  return row;
}
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
  const result = { root, identity: `${stat.dev}:${stat.ino}`, held: () => held,
    release() { if (held) { native.release(handle); held = false; liveOwnerLockHandles.delete(handle); } } };
  const snapshot = Object.freeze({ ...result });
  let changed = false;
  const row = Object.freeze({ root, identity: result.identity,
    assertLocal() {
      if (changed) throw new Error('original_owner_lock_changed');
      const fields = ['root', 'identity', 'held', 'release'] as const;
      for (let index = 0; index < fields.length; index++) {
        const key = fields[index]!;
        const descriptor = ownerDescriptor(result, key);
        if (!descriptor || !ownerHasOwn(descriptor, 'value') || descriptor.value !== snapshot[key]) {
          changed = true; throw new Error('original_owner_lock_changed');
        }
      }
      if (!held || !ownerApply(ownerSetHas, liveOwnerLockHandles, [handle])) throw new Error('owner_lock_lost');
    } });
  ownerApply(ownerLockSet, originalOwnerLocks, [result, row]);
  return result;
}
