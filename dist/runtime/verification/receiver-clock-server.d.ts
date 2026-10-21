import type { Socket } from 'node:net';
import type { ReceiverClockEvidence } from './receiver-store.js';
/** Private root composition only; authenticateReceiver revalidates the fixed
 * registration on every accept and dispatch. This never extends broker.sock. */
export declare function startReceiverClockServer(input: {
    socketPath: string;
    authenticateReceiver(socket: Socket): number;
    assertReceiver(uid: number): void;
    sample(): ReceiverClockEvidence;
}): Promise<{
    close(): Promise<void>;
}>;
