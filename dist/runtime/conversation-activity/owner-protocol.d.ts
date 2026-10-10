export declare const ACTIVITY_OWNER_PROTOCOL = 1;
export declare const ACTIVITY_OWNER_GENERATION = 2;
export declare const ACTIVITY_REQUEST_BYTES: number;
export declare const ACTIVITY_RESPONSE_BYTES: number;
export type ActivityClientRole = 'user' | 'producer';
export interface ActivityOwnerCredentials {
    version: 1;
    rootHash: string;
    user: string;
    producer: string;
}
export interface ActivityOwnerAddress {
    dataRoot: string;
    rootHash: string;
    socketPath: string;
    credentialsPath: string;
}
/** A new per-root protocol; never reuses the legacy reminder daemon socket. */
export declare function activityOwnerAddress(dataRoot: string): ActivityOwnerAddress;
export declare function readActivityOwnerCredentials(address: ActivityOwnerAddress): ActivityOwnerCredentials;
/** Only initial bootstrap creates credentials. Existing tokens never rotate
 * silently and are never overwritten by a competing startup. */
export declare function createActivityOwnerCredentials(address: ActivityOwnerAddress): ActivityOwnerCredentials;
export declare function authenticateActivityClient(credentials: ActivityOwnerCredentials, hello: unknown): ActivityClientRole;
