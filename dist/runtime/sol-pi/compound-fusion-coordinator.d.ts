import type { CompoundRegistryExecutionPort } from '../../ai/tools/index.js';
import type { SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
import type { createCompoundSessionJournal } from './compound-session-journal.js';
import type { CompoundOperationRecord, CompoundOperationLedger } from './compound-operation.js';
import { type CompoundValidationBackend } from './compound-validation.js';
type Request = Parameters<CompoundRegistryExecutionPort['execute']>[0];
type Journal = ReturnType<typeof createCompoundSessionJournal>;
export declare function parseCompoundValidation(value: unknown): Record<string, unknown>;
/** Combines the actual Registry preparation/execution APIs; it is not an issuer
 * of either file permission or isolated-engine qualification. */
export declare function executeCompoundFusion(input: {
    request: Request;
    inputHash: string;
    signal: AbortSignal;
    journal: Journal;
    backend: CompoundValidationBackend;
    permissionGeneration: number;
    assertCurrent(): void;
    getPermissionRevision(): number;
    assertCommandTool(): void;
    noteCommittedRecord?(record: CompoundOperationRecord): void;
    withLease<T>(work: (lease: SessionExecutionLease) => Promise<T>, signal?: AbortSignal): Promise<T>;
    settlePrepared(id: string, outcome: 'cancelled' | 'denied' | 'invalid'): Promise<void>;
    settleCommittedValidation(id: string, status: 'cancelled' | 'denied'): Promise<void>;
    persistCurrentHistory?(lease: SessionExecutionLease): Promise<void>;
    composeResult?(invocationId: string, before: string, body: string, after: string): string;
    createProjector?(invocationId: string, lease: SessionExecutionLease): (nativeResult: string) => Promise<string>;
    prepare<T>(promise: Promise<T>, signal: AbortSignal): Promise<T>;
    uncertain(ledger: CompoundOperationLedger): boolean;
}): Promise<string>;
export {};
