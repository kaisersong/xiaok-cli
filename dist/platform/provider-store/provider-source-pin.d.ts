/**
 * Live source pin + per-launch journals (design v58 §4.4; R29-02, R30-01,
 * R32-02, R33-01, R33-02, R34-02).
 *
 * Purpose: prove, across processes, that a materialised source/runtime root is
 * still referenced, so no installer/pruner/uninstall can delete code that a live
 * provider child is executing.
 *
 * Layout under `pins/<name>/<digest>/<instanceId>/`:
 *   source.json                     immutable description of what is pinned
 *   owners/main/000-acquired.json   written before the root is exposed
 *   owners/main/090-released.json   normal shutdown, every ref closed
 *   owners/main/095-owner-dead.json appended by a later process after proving death
 *   refs/<launchId>/000-starting.json   fsynced BEFORE spawn (crash window)
 *   refs/<launchId>/010-spawned.json    pid + start identity, tree unverified
 *   refs/<launchId>/020-orphaned.json   cleanup could not prove the tree is empty
 *   refs/<launchId>/090-released.json   observer proved the population is empty
 *   refs/<launchId>/090-not-created.json only with full pre-spawn evidence
 *
 * Durability rule: unique file via `open('wx')` → full payload with checksum →
 * fsync file → fsync directory. A repeated append with byte-identical content is
 * an idempotent no-op; different content for the same event is invalid and fails
 * closed. Nothing is ever rewritten in place, so two launches can never lose
 * each other's updates (that is why per-launch journals replaced one JSON doc).
 */
import type { ProcessIdentity } from './plugin-claim-lock.js';
export declare const PIN_SCHEMA = "xiaok-provider-source-pin-v1";
export type RefEvent = '000-starting' | '010-spawned' | '020-orphaned' | '090-released' | '090-not-created';
export type MainOwnerEvent = '000-acquired' | '090-released' | '095-owner-dead';
export declare class PinFailClosedError extends Error {
    readonly code: string;
    constructor(code: string, detail: string);
}
export interface PinnedSourceDescription {
    readonly pluginName: string;
    readonly sourceDigest: string;
    readonly sourceSnapshotPath: string;
    readonly runtimeContractDigest?: string;
    readonly runtimeGenerationPath?: string;
}
export interface LaunchRef {
    readonly launchId: string;
    /** Written and fsynced BEFORE spawn, so a crash cannot hide the child. */
    markSpawned(identity: ProcessIdentity): void;
    markOrphaned(observation: string): void;
    /** Only valid with complete pre-spawn evidence (design R34-02). */
    markNotCreated(evidence: PreSpawnFailureEvidence): void;
    /** Requires a production observer proof that the whole population is gone. */
    release(observation: string): void;
}
/**
 * The single accepted proof that no child was ever created (design R34-02): a
 * synchronous pre-spawn failure with no pid, no spawn event, no exit, one
 * numeric ENOENT/EACCES and a matching `close(errno, null)`.
 */
export interface PreSpawnFailureEvidence {
    readonly spawnObserved: false;
    readonly everHadPid: false;
    readonly exitObserved: false;
    readonly errorCode: 'ENOENT' | 'EACCES';
    readonly errno: number;
    readonly syscall: string;
    readonly path: string;
    readonly spawnargs: readonly string[];
    readonly closeCode: number;
    readonly closeSignal: null;
}
export declare function isCompletePreSpawnEvidence(e: PreSpawnFailureEvidence): boolean;
export declare class ProviderSourcePin {
    private readonly description;
    readonly instanceId: string;
    private readonly self;
    private readonly instanceDir;
    private readonly ownersMainDir;
    private readonly refsDir;
    constructor(pinsRoot: string, description: PinnedSourceDescription, instanceId: string, self: () => ProcessIdentity);
    get path(): string;
    /** Must complete before the pinned root is exposed to services. */
    acquireMain(): void;
    /**
     * Normal shutdown only: requires every known ref closed. Otherwise we leave
     * `000-acquired` in place and let the next process prove death.
     */
    releaseMain(reason: string): {
        released: boolean;
        blockedBy?: string[];
    };
    private openRefs;
    /** Creates the launch ref and fsyncs `000-starting` BEFORE the caller spawns. */
    beginLaunch(launchId: string): LaunchRef;
}
export type InstanceVerdict = {
    kind: 'inactive';
    instanceId: string;
} | {
    kind: 'in_use';
    instanceId: string;
    reason: string;
    detail: string[];
};
/**
 * The single production reducer. Tests must use it rather than re-implementing
 * the state machine.
 */
export declare function reducePinState(pinsRoot: string, pluginName: string, sourceDigest: string, probeIdentity: (pid: number) => ProcessIdentity | null): InstanceVerdict[];
/** Only a process holding the plugin lock may record another owner's death. */
export declare function recordMainOwnerDead(pinsRoot: string, pluginName: string, sourceDigest: string, instanceId: string, observation: string): void;
export declare function isSourceDeletable(verdicts: InstanceVerdict[]): boolean;
