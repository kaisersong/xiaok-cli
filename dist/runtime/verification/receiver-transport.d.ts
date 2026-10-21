import type { createReceiverUploadVerifier } from './receiver-upload-authentication.js';
import type { Socket } from 'node:net';
import { type VerificationTuple } from './protocol.js';
import type { Identity, SignedReceiverReply, createReceiverReplyVerifier } from './receiver-authentication.js';
import type { readControllerSocketAuditPeer } from './socket-peer.js';
type Method = 'stage' | 'commit' | 'cancel' | 'query' | 'upload-finish';
type Request = {
    tuple: VerificationTuple;
    fullTupleHash: string;
    challenge: string;
    payload?: string;
    expectedRevision?: number;
};
/** Private protocol assembly. Ports in tests do not establish installed authority.
 * Unknown transport outcomes never trigger replay, cancellation or completion. */
export declare function createReceiverTransport(input: {
    socketPath: string;
    receiverServiceUid: number;
    identity: Identity;
    verifier: Pick<ReturnType<typeof createReceiverReplyVerifier>, 'verify' | 'read'>;
    uploadVerifier: ReturnType<typeof createReceiverUploadVerifier>;
    assertCurrent(): void;
    readPeer(socket: Socket): ReturnType<typeof readControllerSocketAuditPeer>;
}): Readonly<{
    call(method: Method, payload: Request, signal?: AbortSignal, beforeSend?: () => void): Promise<Readonly<{
        envelope: SignedReceiverReply;
        authenticated: import("./receiver-authentication.js").AuthenticatedReceiverReply;
    }>>;
    stagePayload(base: Pick<Request, "tuple" | "fullTupleHash" | "challenge">, bytes: Buffer, signal?: AbortSignal, beforeSend?: () => void): Promise<Readonly<{
        envelope: SignedReceiverReply;
        authenticated: import("./receiver-authentication.js").AuthenticatedReceiverReply;
    }>>;
    close(): Promise<void>;
}>;
export {};
