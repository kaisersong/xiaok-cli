import { type KeyObject } from 'node:crypto';
import { type InstalledControllerLifetime } from './installed-controller-lifetime.js';
export interface InstalledReceiverDefinition {
    version: 1;
    receiverId: string;
    receiverInstanceEpoch: number;
    keyId: string;
    publicKeyPem: string;
    serviceUid: number;
}
export declare function assertInstalledReceiverRegistration(value: object, lifetime: Readonly<InstalledControllerLifetime>): void;
/** Parsing config does not prove a live receiver or its durable instance epoch. */
export declare function parseInstalledReceiverRegistration(raw: unknown, policy: {
    controllerPublicKey: KeyObject;
    controllerServiceUid: number;
    interactiveUids: readonly number[];
}): Readonly<InstalledReceiverDefinition>;
/** Fixed installed read-only registration. Separate receiver service/DB must still
 * authenticate socket peers and its original durable epoch before any commit. */
export declare function createInstalledReceiverRegistration(lifetime: Readonly<InstalledControllerLifetime>): Readonly<{
    identity: Readonly<{
        receiverId: string;
        receiverInstanceEpoch: number;
        keyId: string;
    }>;
    definition: Readonly<InstalledReceiverDefinition>;
    receiverVerifier: Readonly<{
        revoke(): void;
        read(reply: import("./receiver-authentication.js").AuthenticatedReceiverReply): Readonly<import("./receiver-authentication.js").Identity & {
            domain: "xiaok.p3r.receiver.v1";
            fullTupleHash: string;
            challenge: string;
            result: import("./receiver-authentication.js").ReceiverReplyResult;
        }>;
        verify(envelope: import("./receiver-authentication.js").SignedReceiverReply, request: import("./receiver-authentication.js").ReceiverReplyRequest): import("./receiver-authentication.js").AuthenticatedReceiverReply;
    }>;
    socketPath: string;
    assertCurrent: () => void;
    close(): void;
}>;
