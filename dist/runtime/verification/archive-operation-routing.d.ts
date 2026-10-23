import type { ControllerPeer } from './controller-public-daemon.js';
import type { createUserArchiveOperations } from './user-archive-operations.js';
/** Fixed private composition adapter. Caller supplies the kernel peer; payload
 * source is passed unchanged to the actual native-authorization service. */
export declare function createArchiveOperationRouting(operations: ReturnType<typeof createUserArchiveOperations>, ensureQualified: (signal: AbortSignal) => Promise<void>): Readonly<{
    invoke(method: string, payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<unknown>;
}>;
