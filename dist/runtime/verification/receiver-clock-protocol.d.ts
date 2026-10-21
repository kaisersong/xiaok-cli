import type { ReceiverClockEvidence } from './receiver-store.js';
/** Same kernel continuous clock only. Authentication belongs to the fixed socket
 * transport; this parser never turns an untrusted response into authority. */
export declare function validateReceiverClockRoundTrip(value: unknown, expected: {
    nonce: string;
    before: bigint;
    after: bigint;
}): Readonly<ReceiverClockEvidence>;
