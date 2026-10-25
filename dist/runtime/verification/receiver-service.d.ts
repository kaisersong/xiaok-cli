import { type KeyObject } from 'node:crypto';
import type { Socket } from 'node:net';
import type { readControllerSocketAuditPeer } from './socket-peer.js';
import { type Identity } from './receiver-authentication.js';
import type { VerificationReceiverStore } from './receiver-store.js';
/** Private service boundary. Only the installed entry supplies protected identity,
 * actual kernel peer reader and store clock; injection does not qualify an OS. */
export declare function startReceiverService(input: {
    socketPath: string;
    controllerServiceUid: number;
    identity: Identity;
    privateKey: KeyObject;
    store: VerificationReceiverStore;
    assertCurrent(): void;
    readPeer(socket: Socket): ReturnType<typeof readControllerSocketAuditPeer>;
}): Promise<Readonly<{
    close(): Promise<void>;
}>>;
