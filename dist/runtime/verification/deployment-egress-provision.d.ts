export interface EgressProvisionTarget {
    readonly destination: string;
    readonly model: string;
    readonly protocol: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly credentialId?: string;
}
export interface EgressProvisionBundle {
    readonly targets: Readonly<{
        version: 1;
        targets: readonly EgressProvisionTarget[];
    }>;
    readonly credentials: Readonly<Record<string, Readonly<Record<string, string>>>>;
}
/** Pure schema validation only: this does not authorize a request, write a
 * credential, install a service or certify an OS identity. Errors omit input. */
export declare function parseEgressProvisionBundle(value: unknown): EgressProvisionBundle;
