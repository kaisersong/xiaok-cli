import type { createIntentProducerRegistryAdapter } from '../../ai/tools/intent-delegation.js';
import { type SessionExecutionChain } from '../../ai/runtime/session-store/execution-chain.js';
import { type CompoundValidationBackend } from './compound-validation.js';
import type { Tool } from '../../types.js';
import type { CompoundRegistryExecutionPort } from '../../ai/tools/index.js';
import type { SessionExecutionAuthority, SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
import type { createCompoundSessionJournal } from './compound-session-journal.js';
import type { CompoundOperationRecord } from './compound-operation.js';
import type { DirectOperationRecord } from './compound-direct-operation.js';
export interface CompoundExecutionCoordinator extends CompoundRegistryExecutionPort {
    dispose(): Promise<void>;
    publishCurrentHistory(): Promise<void>;
}
export declare function abortablePreparation<T>(promise: Promise<T>, signal: AbortSignal): Promise<T>;
type Journal = ReturnType<typeof createCompoundSessionJournal>;
/** Host-bound registry coordinator. This initial implementation admits direct
 * synchronous native files and audited reads. Fusion/commands require the actual
 * qualified execution port and are never silently reduced to plain file writes. */
export declare function createCompoundExecutionCoordinator(options: {
    executionChain?: SessionExecutionChain;
    validationBackend?: CompoundValidationBackend;
    commandTool?: Tool;
    observationQueries?: readonly {
        tool: Tool;
        assertCurrent(): void;
    }[];
    cancellationTools?: readonly Tool[];
    assertSupervisedDelegation?(lease: SessionExecutionLease): void;
    captureGlobalSupervision?(lease: SessionExecutionLease): (issued?: DirectOperationRecord | CompoundOperationRecord) => void;
    delegation?: {
        tools: readonly Tool[];
        execute(request: Parameters<CompoundRegistryExecutionPort['execute']>[0], inputHash: string, signal: AbortSignal, withLease: <T>(callback: (lease: SessionExecutionLease) => Promise<T>, signal?: AbortSignal) => Promise<T>, settlePrepared: (id: string, outcome: 'cancelled' | 'denied' | 'invalid') => Promise<void>): Promise<string>;
    };
    intentReports?: ReturnType<typeof createIntentProducerRegistryAdapter>;
    journal: Journal;
    authority: SessionExecutionAuthority;
    sessionIdentity: string;
    assertCurrent(): void;
    composeResult?(invocationId: string, before: string, body: string, after: string): string;
    createProjector?(invocationId: string, lease: SessionExecutionLease): (nativeResult: string) => Promise<string>;
    settlePublishedDelegations?(lease: SessionExecutionLease): Promise<void>;
    persistCurrentHistory?(lease: SessionExecutionLease): Promise<void>;
    getPermissionRevision(): number;
    executionSignal?: AbortSignal;
    readonlyTools: readonly Tool[];
    fileTools: readonly Tool[];
}): CompoundExecutionCoordinator;
export {};
