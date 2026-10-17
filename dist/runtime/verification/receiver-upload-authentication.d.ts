import { type KeyObject } from 'node:crypto';
import type { Identity } from './receiver-authentication.js';
export interface UploadProgress {
    fullTupleHash: string;
    totalBytes: number;
    receivedBytes: number;
}
export interface UploadRequestBinding {
    requestHash: string;
    challenge: string;
}
export interface SignedUploadReply {
    payload: Identity & UploadRequestBinding & {
        domain: 'xiaok.receiver.upload.v1';
        progress: UploadProgress;
    };
    signature: string;
}
/** Separate signature domain: an upload acknowledgement is never a publication reply. */
export declare function createReceiverUploadSigner(input: Identity & {
    privateKey: KeyObject;
}): Readonly<{
    sign(binding: UploadRequestBinding, value: UploadProgress): SignedUploadReply;
}>;
export declare function createReceiverUploadVerifier(input: Identity & {
    publicKey: KeyObject;
}): Readonly<{
    verify(raw: SignedUploadReply, binding: UploadRequestBinding): Readonly<UploadProgress>;
}>;
