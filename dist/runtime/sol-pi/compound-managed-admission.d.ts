import { type ObservationSessionOwner } from './observation-session-owner.js';
import type { AgentSessionState } from '../../ai/runtime/session.js';
import type { SessionStore } from '../../ai/runtime/session-store/store.js';
import { type SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
/** Host-only identity of a durable P2 managed-child admission. Serialized facts
 * do not grant execution, prove drain, or authorize a resource-release receipt. */
declare const managedAdmissionBrand: unique symbol;
export interface ManagedCompoundAdmission {
    readonly [managedAdmissionBrand]: true;
}
export interface ManagedCompoundAdmissionBinding {
    readonly admissionId: string;
    readonly admissionGeneration: number;
    readonly childSessionId: string;
    readonly operationId: string;
    readonly parentOperationId: string;
    readonly parentSessionId: string;
    readonly groupId: string;
    readonly agentId: string;
    readonly rootEpoch: number;
}
/** Serialized or copied preparation facts cannot obtain this binding. */
export declare function getManagedCompoundAdmissionBinding(cap: ManagedCompoundAdmission): Readonly<ManagedCompoundAdmissionBinding>;
/** Internal coordinator factory: captures only a real committed parent admission
 * under its original live owner/lease. This identity receipt does not authorize
 * a tool, activate an actor, prove drain, or replace main preparation approval. */
export declare function captureManagedCompoundAdmission(input: {
    owner: ObservationSessionOwner;
    session: AgentSessionState;
    store: SessionStore;
    root: string;
    lease: SessionExecutionLease;
    parentOperationId: string;
}): Promise<ManagedCompoundAdmission>;
export {};
