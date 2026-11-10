import { mkdirSync, realpathSync, statSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendIntrinsic, createIntrinsicSet } from '../../src/runtime/verification/intrinsic-async-collection.js';
export function harnessOwnerPlatformQualified(platform: string): boolean { return platform === 'darwin'; }
export interface HarnessOwnerLock {
    root: string;
    identity: string;
    held(): boolean;
    release(): void;
}
interface SourceGuard {
    assertKnown(): void;
    retain(raw: unknown): void;
}
interface OwnerView {
    readonly root: string;
    readonly identity: string;
    assertLocal(): void;
}
interface OriginalOwner {
    view: Readonly<OwnerView>;
    addGuard(guard: SourceGuard): void;
    retryRequestedRelease(): void;
}
// Pin original lock objects; their fixed release closures strongly retain the
// Native handle. A pending/unknown Source can never let GC drop its flock.
const liveOwnerLocks = createIntrinsicSet<object>();
const originalOwnerLocks = new WeakMap<object, OriginalOwner>();
const ownerLockGet = WeakMap.prototype.get, ownerLockSet = WeakMap.prototype.set, ownerApply = Reflect.apply;
const ownerDescriptor = Object.getOwnPropertyDescriptor, ownerHasOwn = Object.hasOwn;
const physicalDirectory = realpathSync.native, directoryStat = statSync;
function original(candidate: unknown): OriginalOwner | undefined {
    return candidate !== null && (typeof candidate === 'object' || typeof candidate === 'function')
        ? ownerApply(ownerLockGet, originalOwnerLocks, [candidate]) as OriginalOwner | undefined : undefined;
}
/** Original native acquisition membership only; no file/DB or execution grant. */
export function readOriginalHarnessOwnerLock(candidate: unknown): Readonly<OwnerView> {
    const row = readOptionalOriginalHarnessOwnerLock(candidate);
    if (!row)
        throw new Error('original_owner_lock_required');
    return row;
}
/** A nonmember is absent; an invalid original is never a legacy fallback. */
export function readOptionalOriginalHarnessOwnerLock(candidate: unknown): Readonly<OwnerView> | null {
    const record = original(candidate);
    if (!record)
        return null;
    record.view.assertLocal();
    return record.view;
}
/** Restrictive private Source binding only. This never accepts a caller's
 * claimed root/identity/known boolean, removes a guard or grants permission.
 * The original factory always registers its actual row before its first SDK. */
export function retainOriginalHarnessOwnerLocksForSource(dbPath: string, assertKnown: () => void, retain: (raw: unknown) => void): (() => void) | null {
    if (typeof dbPath !== 'string' || typeof assertKnown !== 'function' || typeof retain !== 'function')
        throw new Error('original_owner_source_binding');
    if (dbPath === '' || dbPath === ':memory:')
        return null;
    const objects = liveOwnerLocks.snapshot(), records: OriginalOwner[] = [], matched: OriginalOwner[] = [];
    const guard: SourceGuard = { assertKnown, retain }, lexical = dirname(resolve(dbPath));
    for (let i = 0; i < objects.length; i++) {
        const record = original(objects[i])!;
        appendIntrinsic(records, record);
        // Bind the ordinary canonical path before the first normalization SDK too.
        if (record.view.root === lexical) {
            record.addGuard(guard);
            appendIntrinsic(matched, record);
        }
    }
    try {
        const directory = physicalDirectory(lexical), facts = directoryStat(directory, { bigint: true }), identity = `${facts.dev}:${facts.ino}`;
        for (let i = 0; i < records.length; i++) {
            const record = records[i]!;
            if (record.view.root === directory && record.view.identity === identity) {
                record.addGuard(guard);
                if (matched.indexOf(record) < 0)
                    appendIntrinsic(matched, record);
            }
        }
    }
    catch (raw) {
        // An uncertain match can only retain more original locks, never approve one.
        for (let i = 0; i < records.length; i++)
            records[i]!.addGuard(guard);
        throw raw;
    }
    if (!matched.length)
        return null;
    return () => { for (let i = 0; i < matched.length; i++)
        matched[i]!.view.assertLocal(); };
}
/** Finish only a release already requested by its original owner. An unknown
 * Source or Native release stays pinned; this notification never replaces the
 * Source close operation's original Error/undefined outcome. */
export function retryRequestedHarnessOwnerReleases(): void {
    const values = liveOwnerLocks.snapshot();
    for (let i = 0; i < values.length; i++) {
        try {
            original(values[i])?.retryRequestedRelease();
        }
        catch { /* The original record keeps its failure and Native handle. */ }
    }
}
export function acquireHarnessOwnerLock(dataRoot: string): HarnessOwnerLock {
    if (!harnessOwnerPlatformQualified(process.platform))
        throw new Error('owner_platform_unqualified');
    mkdirSync(dataRoot, { recursive: true });
    const root = physicalDirectory(dataRoot), stat = directoryStat(root, { bigint: true });
    if (!stat.isDirectory() || stat.ino === 0n)
        throw new Error('owner_identity_unavailable');
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [join(here, 'harness_owner_lock.node'), resolve(here, '../../native/harness-optimization-owner-lock/build/Release/harness_owner_lock.node')];
    const binary = candidates.find(path => existsSync(path));
    if (!binary)
        throw new Error('owner_lock_unavailable');
    const native = createRequire(import.meta.url)(binary) as {
        acquire(path: string): unknown;
        release(handle: unknown): void;
    };
    const acquire = native.acquire, releaseNative = native.release;
    const handle = ownerApply(acquire, native, [join(root, 'harness-optimization.owner.lock')]);
    const guards: SourceGuard[] = [];
    let held = true, requested = false, releaseEntered = false, releaseFailure: {
        raw: unknown;
    } | undefined;
    let result: HarnessOwnerLock;
    function retainFailure(raw: unknown) {
        releaseFailure ??= { raw };
        for (let i = 0; i < guards.length; i++) {
            try {
                guards[i]!.retain(raw);
            }
            catch { /* Do not mask the Native release's original value. */ }
        }
    }
    function finishRelease(quiet: boolean) {
        if (!held || releaseEntered)
            return;
        for (let i = 0; i < guards.length; i++) {
            try {
                const value = guards[i]!.assertKnown();
                if (value !== undefined)
                    return;
            }
            catch {
                return;
            }
        }
        releaseEntered = true;
        try {
            const raw = ownerApply(releaseNative, native, [handle]);
            if (raw !== undefined) {
                retainFailure(raw);
                throw new Error('owner_lock_release_unconfirmed');
            }
            held = false;
            liveOwnerLocks.delete(result);
        }
        catch (raw) {
            retainFailure(raw);
            if (!quiet)
                throw raw;
        }
    }
    // The fixed release function is born before the snapshot; never replace it.
    result = { root, identity: `${stat.dev}:${stat.ino}`, held: () => held, release() { requested = true; finishRelease(false); } };
    liveOwnerLocks.add(result);
    const snapshot = Object.freeze({ ...result });
    let changed = false;
    const view = Object.freeze({ root, identity: result.identity, assertLocal() {
            if (changed)
                throw new Error('original_owner_lock_changed');
            const fields = ['root', 'identity', 'held', 'release'] as const;
            for (let i = 0; i < fields.length; i++) {
                const key = fields[i]!, field = ownerDescriptor(result, key);
                if (!field || !ownerHasOwn(field, 'value') || field.value !== snapshot[key]) {
                    changed = true;
                    throw new Error('original_owner_lock_changed');
                }
            }
            if (!held || !liveOwnerLocks.has(result))
                throw new Error('owner_lock_lost');
            if (releaseFailure)
                throw new Error('owner_lock_release_unconfirmed', { cause: releaseFailure.raw });
            if (requested)
                throw new Error('owner_lock_release_pending');
        } });
    const record: OriginalOwner = { view, addGuard(guard) {
            for (let i = 0; i < guards.length; i++)
                if (guards[i]!.assertKnown === guard.assertKnown)
                    return;
            appendIntrinsic(guards, guard);
        }, retryRequestedRelease() { if (requested)
            finishRelease(true); } };
    ownerApply(ownerLockSet, originalOwnerLocks, [result, record]);
    return result;
}
