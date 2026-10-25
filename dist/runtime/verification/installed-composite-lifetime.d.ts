import { type CompositeServiceRegistration } from './composite-service-registration.js';
export declare function assertInstalledCompositeLifetime(value: object): void;
/** Independent fixed service identity. It cannot reuse controller keys, UID or
 * state; store closure/drain must complete before releasing this lifetime lock. */
export declare function createInstalledCompositeLifetime(kind: CompositeServiceRegistration['kind']): Readonly<{
    base: "/Library/Application Support/xiaok-verification";
    state: string;
    release: string;
    manifest: Readonly<import("./deployment-manifest.js").InstalledDeploymentManifest>;
    pair: Readonly<{
        egress: Readonly<CompositeServiceRegistration>;
        participant: Readonly<CompositeServiceRegistration>;
    }>;
    definition: Readonly<CompositeServiceRegistration>;
    privateKey: import("crypto").KeyObject;
    publicKey: import("crypto").KeyObject;
    peerHelper: string;
    assertCurrent: () => void;
    close(): void;
}>;
export type InstalledCompositeLifetime = ReturnType<typeof createInstalledCompositeLifetime>;
