import { type Socket } from 'node:net';
/** Framing only: the protected daemon dispatcher must authenticate and authorize every operation. */
export declare function startControllerIpc(options: {
    socketPath: string;
    requestTimeoutMs?: number;
    publicPeerAuthenticated?: true;
    acceptPeer?: (socket: Socket) => unknown;
    dispatch: (body: Buffer, signal: AbortSignal, peer?: unknown) => Promise<Buffer>;
}): Promise<{
    close(): Promise<void>;
}>;
export declare function callControllerIpc(socketPath: string, body: Buffer, options?: {
    timeoutMs?: number;
    signal?: AbortSignal;
    verifyServerPeer?: (socket: Socket) => void;
}): Promise<Buffer>;
