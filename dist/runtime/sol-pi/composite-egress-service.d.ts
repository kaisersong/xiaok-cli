import type { RequestOptions } from 'node:https';
import { type CompositeEgressAttempt } from './composite-egress-journal.js';
import { type CompositeParticipantIdentity } from './composite-participant-receipt.js';
export interface CompositeEgressTarget {
    destination: string;
    model: string;
    protocol: string;
    headers: Readonly<Record<string, string>>;
}
/** Normal one-attempt lifecycle. The installed composition supplies fixed targets
 * and registered participant identity; this does not issue a process-stop receipt. */
export declare function createCompositeEgressService(input: {
    root: string;
    egressId: string;
    generation: number;
    participant: CompositeParticipantIdentity & {
        publicKeyPem: string;
    };
    targets: readonly CompositeEgressTarget[];
    assertCurrent(): void;
    certificateAuthority?: RequestOptions['ca'];
}): Readonly<{
    prepare(attempt: CompositeEgressAttempt, receiptBytes: Buffer): import("./composite-egress-journal.js").CompositeEgressRecord | undefined;
    dispatch(attemptId: string, body: string): Promise<{
        status: number;
        body: string;
    }>;
    query(attemptId: string): import("./composite-egress-journal.js").CompositeEgressRecord | undefined;
    cancel(attemptId: string): import("./composite-egress-journal.js").CompositeEgressRecord | undefined;
    close(): Promise<void>;
}>;
