import { type InstalledControllerLifetime } from './installed-controller-lifetime.js';
import { type createInstalledReceiverRegistration } from './installed-receiver-registration.js';
/** Private fixed installed factory. Neither endpoint nor peer identity comes from RPC. */
export declare function createInstalledReceiverTransport(lifetime: Readonly<InstalledControllerLifetime>, registration: ReturnType<typeof createInstalledReceiverRegistration>): Readonly<{
    call(method: "stage" | "commit" | "query" | "cancel" | "upload-finish", payload: {
        tuple: import("./protocol.js").VerificationTuple;
        fullTupleHash: string;
        challenge: string;
        payload?: string;
        expectedRevision?: number;
    }, signal?: AbortSignal, beforeSend?: () => void): Promise<Readonly<{
        envelope: import("./receiver-authentication.js").SignedReceiverReply;
        authenticated: import("./receiver-authentication.js").AuthenticatedReceiverReply;
    }>>;
    stagePayload(base: Pick<{
        tuple: import("./protocol.js").VerificationTuple;
        fullTupleHash: string;
        challenge: string;
        payload?: string;
        expectedRevision?: number;
    }, "tuple" | "fullTupleHash" | "challenge">, bytes: Buffer, signal?: AbortSignal, beforeSend?: () => void): Promise<Readonly<{
        envelope: import("./receiver-authentication.js").SignedReceiverReply;
        authenticated: import("./receiver-authentication.js").AuthenticatedReceiverReply;
    }>>;
    close(): Promise<void>;
}>;
