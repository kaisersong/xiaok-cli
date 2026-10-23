import { type CompoundHostStorage } from '../sol-pi/compound-host-storage.js';
import { type openCompoundExecutionDomain } from '../sol-pi/compound-execution-domain.js';
import { type SessionStore, type PersistedSessionSnapshot } from '../../ai/runtime/session-store/store.js';
import type { SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
import { type ManagedCompoundAdmission } from '../sol-pi/compound-managed-admission.js';
import { type AgentSessionSnapshot } from '../../ai/runtime/session.js';
import { type ProtectedObservationClosure } from '../../ai/runtime/protected-observation-closure.js';
export declare function desktopObservationSessionId(taskId: string): string;
/** Main-owned session sidecar. No delete/clear API: stale task journals cannot erase protection or execution ledgers. */
export interface DesktopExecutionPersistence {
    readonly root: string;
    readonly store: SessionStore;
    routeCanonical?(layout: CompoundHostStorage): DesktopExecutionPersistence;
    registerAlias?(domain: ReturnType<typeof openCompoundExecutionDomain>, lease: SessionExecutionLease): Promise<void>;
    getCompoundTreeStore?(domain: ReturnType<typeof openCompoundExecutionDomain>): SessionStore;
    registerManagedAlias?(admission: ManagedCompoundAdmission, domain: ReturnType<typeof openCompoundExecutionDomain>, lease: SessionExecutionLease): Promise<void>;
    initialize(snapshot: PersistedSessionSnapshot, lease: SessionExecutionLease): Promise<void>;
}
interface ExecutionPersistenceTracking {
    run<T>(work: () => Promise<T>): Promise<T>;
    write<T>(work: () => Promise<T>, confirmedRejection?: (originalPromise: Promise<T>) => boolean): Promise<T>;
}
export declare class DesktopTaskObservationStore {
    private readonly root;
    private readonly sessions;
    private canonicalRoot;
    private alias;
    private assertNotAlias;
    /** Validates already committed canonical facts; never writes either history. */
    publishCanonicalFacts(taskId: string, snapshot: AgentSessionSnapshot): boolean;
    constructor(root: string, canonicalRoot?: string);
    /** Host-only raw read. Cancellation abandons its caller, never this thread.
     * Only actual thread exit confirms completion of the original FileStore IO. */
    readProtectionInWorker(taskId: string): Promise<{
        closure?: ProtectedObservationClosure;
        executionProtected?: true;
    }>;
    /** Main-only complete durable view, including registered canonical aliases.
     * It returns no writer and never derives a root from an untrusted marker. */
    loadSessionSnapshot(taskId: string): Promise<PersistedSessionSnapshot | null>;
    readProtection(taskId: string): Promise<{
        closure?: ProtectedObservationClosure;
        executionProtected?: true;
    }>;
    read(taskId: string): Promise<ProtectedObservationClosure | undefined>;
    readProtectionSync(taskId: string): {
        closure?: ProtectedObservationClosure;
        executionProtected?: true;
    };
    readSync(taskId: string): ProtectedObservationClosure | undefined;
    getExecutionPersistence(taskId: string, assertCurrent: () => void, tracking?: ExecutionPersistenceTracking): DesktopExecutionPersistence;
    private executionPersistence;
    save(taskId: string, closure: ProtectedObservationClosure): Promise<void>;
    persistSession(taskId: string, snapshot: AgentSessionSnapshot): Promise<void>;
}
export {};
