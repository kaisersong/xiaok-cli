export interface NativeSessionIdentity {
    schemaVersion: 1;
    sessionId: string;
    cwd: string;
    ownership?: {
        state: string;
        ownerInstanceId?: string;
        previousOwnerInstanceId?: string;
    };
}
/** Native identity header only. Never parses or materializes session messages.
 * New writes put the existing intent ledger before messages; legacy headers
 * without ownership stay readable but cannot grant producer execution. */
export declare function readNativeSessionIdentity(file: string): NativeSessionIdentity | null;
