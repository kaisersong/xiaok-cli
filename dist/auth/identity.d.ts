export interface DevAppIdentity {
    appKey: string;
    appSecret: string;
}
export declare function getDevAppIdentity(): Promise<DevAppIdentity | null>;
export declare function formatIdentityContext(identity: DevAppIdentity | null): string;
