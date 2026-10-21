import { type KeyObject } from 'node:crypto';
import type { ReceiverResult } from './receiver-store.js';
export type ReceiverReplyResult = ReceiverResult | {
    status: 'unknown';
    fullTupleHash: string;
};
export interface ReceiverReplyRequest {
    fullTupleHash: string;
    challenge: string;
}
export interface Identity {
    keyId: string;
    receiverId: string;
    receiverInstanceEpoch: number;
}
export interface SignedReceiverReply {
    payload: Identity & {
        domain: 'xiaok.p3r.receiver.v1';
        fullTupleHash: string;
        challenge: string;
        result: ReceiverReplyResult;
    };
    signature: string;
}
export interface AuthenticatedReceiverReply {
    readonly authenticatedReceiverReply: true;
}
/** Install only inside the independently protected receiver service; never expose this signer to a project worker. */
export declare function createReceiverReplySigner(options: Identity & {
    privateKey: KeyObject;
}): Readonly<{
    sign(request: ReceiverReplyRequest, result: ReceiverReplyResult): SignedReceiverReply;
}>;
/** Registration is host deployment configuration, not a public requestSource/user claim. */
export declare function createReceiverReplyVerifier(options: Identity & {
    publicKey: KeyObject;
}): Readonly<{
    revoke(): void;
    read(reply: AuthenticatedReceiverReply): Readonly<Identity & {
        domain: "xiaok.p3r.receiver.v1";
        fullTupleHash: string;
        challenge: string;
        result: ReceiverReplyResult;
    }>;
    verify(envelope: SignedReceiverReply, request: ReceiverReplyRequest): AuthenticatedReceiverReply;
}>;
