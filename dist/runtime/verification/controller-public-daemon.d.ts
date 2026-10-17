import { type KeyObject } from 'node:crypto';
import type { Socket } from 'node:net';
declare const methods: readonly ["controller.identity", "maintenance.diagnose", "controller.qualification", "materials.prepareRequest", "materials.lookupRequest", "materials.retireRequest", "materials.prepare", "materials.authorize", "materials.stage", "execution.reserve", "execution.dispatch", "execution.quiescence", "verification.inspectObligation", "verification.prepareRequest", "verification.lookupRequest", "verification.retireRequest", "verification.recoverRequest", "verification.prepare", "verification.dispatch", "publication.prepareRequest", "publication.lookupRequest", "publication.recoverRequest", "publication.recoverUnapproved", "publication.prepare", "publication.approve", "publication.reconcile", "publication.recoverExpired", "publication.observeIntentCompletion", "publication.observeIntentDependencies", "publication.observeLoopSet", "publication.observeOwner", "publication.readOwnerPayload", "completion.read-intent-registration", "completion.read-intent-contract", "completion.read-goal-fork-source", "completion.open-owner", "completion.prepare-owner", "completion.prepare-owner-request", "completion.lookup-owner-request", "completion.recover-owner-request", "completion.authorize-owner", "completion.inspect", "completion.settle", "completion.authorize", "completion.receiver-challenge", "completion.receiver-reply", "archive.list", "archive.prepare", "archive.authorize", "archive.read", "archive.delete", "archive.close", "application.prepareRequest", "application.lookupRequest", "application.recoverRequest", "application.prepare", "application.authorize", "application.inspect", "application.reconcile", "capacity.metadata.prepare", "capacity.metadata.confirm", "capacity.metadata.query"];
export type PublicControllerMethod = typeof methods[number];
export interface ControllerPeer {
    readonly uid: number;
    readonly gid: number;
    readonly auditSessionId: number;
}
/** Service-private composition. Installed entry supplies kernel peer reader and qualified
 * authority handlers; this transport never treats a caller DTO or fixture callback as qualification. */
export declare function startPublicController(options: {
    socketPath: string;
    authorityId: string;
    serviceEpoch: string;
    privateKey: KeyObject;
    allowedUserIds: readonly number[];
    acceptPeer(socket: Socket): ControllerPeer;
    invoke(method: PublicControllerMethod, payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<unknown>;
}): Promise<{
    close(): Promise<void>;
}>;
export {};
