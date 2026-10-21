import type { Message } from '../../types.js';
import type { ToolRegistry } from '../../ai/tools/index.js';
import { type ObservationSessionOwner } from './observation-session-owner.js';
import type { AgentSessionState } from '../../ai/runtime/session.js';
import type { CompoundTreeOwner } from './compound-child-installation.js';
import type { SessionStore } from '../../ai/runtime/session-store/store.js';
import { type SessionExecutionAuthority } from '../../ai/runtime/session-store/execution-authority.js';
import { type SessionExecutionChain } from '../../ai/runtime/session-store/execution-chain.js';
import { type CompoundProviderAttempt, type CompoundProviderAttemptInput, type ProviderTransportState } from './compound-provider-attempt.js';
import type { createCompoundSessionJournal } from './compound-session-journal.js';
export interface ProviderAncestorAdmission {
    readonly opaqueProviderAncestorAdmission: true;
}
export interface ProviderAncestorAttempt {
    readonly opaqueProviderAncestorAttempt: true;
}
/** Diagnostic fact about this reserve call, never a quiescence capability.
 * A prior duplicate identity may already have been dispatched elsewhere. */
export declare class CompoundProviderAdmissionError extends Error {
    readonly reservationMayExist: boolean;
    readonly undeliveredState: 'none' | 'cancelled_before_send' | 'unconfirmed';
    readonly noDispatchPossible = true;
    constructor(cause: unknown, reservationMayExist: boolean, undeliveredState: 'none' | 'cancelled_before_send' | 'unconfirmed');
}
export type ProviderAncestorAttemptFacts = Omit<CompoundProviderAttemptInput, 'issuerIncarnation' | 'parentAdmission' | 'rootAdmission'>;
export interface ProviderAncestorAdmissionBinding {
    readonly childSessionIdentity: string;
    reserve(input: ProviderAncestorAttemptFacts & {
        signal?: AbortSignal;
    }): Promise<ProviderAncestorAttempt>;
    consume(ticket: ProviderAncestorAttempt, facts: ProviderAncestorAttemptFacts): void;
    settle(ticket: ProviderAncestorAttempt, state: Exclude<ProviderTransportState, 'reserved'>): Promise<void>;
}
type Journal = ReturnType<typeof createCompoundSessionJournal>;
interface Target {
    root: string;
    sessionIdentity: string;
    authority: SessionExecutionAuthority;
    journal: Journal;
    store?: SessionStore;
}
interface Parent {
    root: string;
    sessionIdentity: string;
    operationId: string;
    generation: number;
    store: SessionStore;
}
export declare function inspectConsumedCompoundProviderAttempt(cap: ProviderAncestorAdmission, ticket: ProviderAncestorAttempt, facts: ProviderAncestorAttemptFacts): 'ordinary' | 'semantic';
/** Recognition of this live issuer only. Caller must independently read the
 * complete canonical tree under its root lease; this grants no new send. */
export declare function assertCompoundProviderLiveReservations(cap: ProviderAncestorAdmission, rows: readonly CompoundProviderAttempt[]): void;
export declare function getProviderAncestorAdmissionBinding(cap: ProviderAncestorAdmission): ProviderAncestorAdmissionBinding;
/** Read-only publication barrier from the actual branded root binding, never a caller snapshot. */
export declare function assertCompoundRootIntentHistory(store: SessionStore, sessionId: string): void;
/** Fixed runtime view. Neither an index nor messages can be supplied by the caller. */
export declare function prepareCompoundRootIntentStageView(session: AgentSessionState, logicalInvocationId?: string): {
    messages: Message[];
    active: boolean;
    assertCurrent(): void;
    dispose(): void;
};
/** Original root issuer only; a readonly check, never a transferable grant. */
export declare function assertCompoundRootIntentProviderCurrent(cap: ProviderAncestorAdmission, signal?: AbortSignal): Promise<void>;
/** Original product lifecycle only; changes invalidate old tickets, never renew them. */
export declare function invalidateCompoundProviderRegistry(cap: ProviderAncestorAdmission): void;
export declare function rebindCompoundProviderRegistry(cap: ProviderAncestorAdmission, registry: ToolRegistry): void;
/** Host factory: no callback can mint admission. Requires the actual branded
 * ancestry and an exact durable running child edge. Local transport completion
 * is NOT physical command quiescence or remote model cancellation. Recovery of
 * a vanished issuer requires a separately authenticated supervisor receipt. */
export declare function createCompoundRootProviderAdmission(input: {
    chain: SessionExecutionChain;
    treeRoot: CompoundTreeOwner;
    owner: ObservationSessionOwner;
    session: AgentSessionState;
    store: SessionStore;
    registry: ToolRegistry;
    executionSignal: AbortSignal;
}): Promise<ProviderAncestorAdmission>;
export declare function createCompoundProviderAdmission(input: {
    chain: SessionExecutionChain;
    parent: Parent;
    ancestors?: readonly Parent[];
    child: Target;
    rootBudget: Target;
    treeRoot?: CompoundTreeOwner;
    issuerIncarnation: string;
    executionSignal: AbortSignal;
    owner?: ObservationSessionOwner;
    registry?: ToolRegistry;
}): Promise<ProviderAncestorAdmission>;
export {};
