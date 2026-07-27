export interface KimiTransportIdentity {
    canonicalBaseUrl?: string;
    wireModel: string;
}
export declare function assertKimiTransportAllowed(identity: KimiTransportIdentity, buildFlavor?: 'normal' | 'rollback'): void;
