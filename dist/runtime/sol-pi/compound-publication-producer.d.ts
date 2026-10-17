import type { AgentSessionState } from '../../ai/runtime/session.js';
import { type ObservationSessionOwner } from './observation-session-owner.js';
import { type ProviderAncestorAdmission, type ProviderAncestorAttempt, type ProviderAncestorAttemptFacts } from './compound-provider-admission.js';
export interface CompoundFinalPublicationTicket {
    readonly opaqueCompoundFinalPublicationTicket: never;
}
type MetadataOrigin = Readonly<{
    session: AgentSessionState;
    nativeInvocationId: string;
}>;
/** Only an original still-open producer captured before admission closed can
 * carry this origin. The lifecycle separately validates the actual metadata row. */
export declare function getCompoundPublicationWindowOrigin(tree: object): MetadataOrigin | undefined;
interface FinalReceiptFacts {
    ticket: CompoundFinalPublicationTicket;
    sessionId: string;
    turnId: string;
    historyDigest: string;
    snapshotRevision: number;
}
interface FinalConsumer {
    register(ticket: CompoundFinalPublicationTicket, notify: (receipt: unknown) => Promise<void>): Promise<void>;
    inspectReceipt(receipt: unknown): Readonly<FinalReceiptFacts>;
}
/** Fixed main/runtime factory port. Neither registrar nor inspector is exposed
 * on tools, session snapshots or transport options. A previous turn must finish
 * its original receipt before this actual owner can bind a new consumer. */
export declare function bindCompoundFinalPublicationConsumer(owner: ObservationSessionOwner, turnId: string, consumer: FinalConsumer): void;
/** Actual root factory admission: wait only for this owner's previous Host tail.
 * Cancelling a new waiter never completes or replaces the original producer. */
export declare function waitForCompoundFinalPublication(owner: ObservationSessionOwner, signal?: AbortSignal): Promise<void>;
export declare function hasCompoundFinalPublicationConsumer(owner: ObservationSessionOwner, turnId: string): boolean;
/** Main/runtime-only iteration boundary. The lifetime ends after its actual
 * transport has drained; it does not close the long-lived owner's issuer. */
export declare function runCompoundPublicationIteration<T>(owner: ObservationSessionOwner, turnId: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T>;
/** Main owns this one bounded window before freezing the new turn input. It
 * grants scheduling admission only; actual turn preparation/activation remains
 * governed by the original Main and ancestor-journal capabilities. */
export declare function openCompoundFollowupPublicationWindow(owner: ObservationSessionOwner, signal: AbortSignal, deadline: number, origin?: MetadataOrigin): Readonly<{
    drained: Promise<void>;
    prepareTurn(turnId: string): void;
    fail: (error: unknown) => void;
    cancelBeforeActivation(error: unknown): void;
}>;
/** Runs actual new input installation inside the first iteration's retained
 * slot. It returns after input installation while the slot awaits that exact
 * iteration, rather than holding a slot for the whole long-lived turn. */
export declare function runCompoundTurnInput(owner: ObservationSessionOwner, turnId: string, work: () => Promise<void>): Promise<void>;
/** Called at the actual provider's final dispatch boundary, after its original
 * opaque attempt was consumed with the exact body/destination/closure tuple. */
export declare function releaseCompoundPublicationHandoff(cap: ProviderAncestorAdmission, ticket: ProviderAncestorAttempt, facts: ProviderAncestorAttemptFacts): void;
/** Metadata publication produced by an already admitted iteration remains in
 * that producer, including a same-tree recipient. Independent Main publication
 * takes its own slot before changing the recipient's session or serial queue. */
export declare function runCompoundObservationPublication<T>(owner: ObservationSessionOwner, work: () => Promise<T>): Promise<T>;
/** The window is keyed by the coordinator's actual tree object, never a caller
 * supplied path or session id. The caller must seal under the original leases
 * after drained resolves; this object grants no execution authority. */
export declare function closeCompoundPublicationWindow(owner: ObservationSessionOwner): import("./producer-window-queue.js").ProducerQueueWindow;
/** Called by the actual final iteration after its complete history publisher.
 * It transfers scheduling ownership, so runner return need not await Main's
 * own result/snapshot tail. No JSON copy can finish this retained producer. */
export declare function prepareCompoundFinalPublication(owner: ObservationSessionOwner, turnId: string): Promise<CompoundFinalPublicationTicket>;
export declare function getCompoundFinalPublicationBinding(ticket: CompoundFinalPublicationTicket): Readonly<{
    session: AgentSessionState;
    sessionId: string;
    rootSessionId: string;
    role: "root" | "child";
    turnId: string;
    producerId: string;
    historyDigest: string;
}>;
/** Only the factory-captured consumer receives this ticket's one completion
 * closure. There is intentionally no exported finish(ticket) operation. */
export declare function publishCompoundFinalPublication(owner: ObservationSessionOwner, turnId: string): Promise<void>;
/** Continues only the transferred tail. It does not reopen the old iteration
 * for new tools or provider dispatch, and does not itself finish the producer. */
export declare function runCompoundFinalPublication<T>(ticket: CompoundFinalPublicationTicket, work: () => Promise<T>): Promise<T>;
export {};
