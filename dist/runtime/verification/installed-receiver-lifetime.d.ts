export declare function assertInstalledReceiverLifetime(value: object): void;
/** Independent fixed service identity. It cannot reuse controller keys, UID or
 * state; store closure/drain must complete before releasing this lifetime lock. */
export declare function createInstalledReceiverLifetime(): Readonly<{
    base: "/Library/Application Support/xiaok-verification";
    state: string;
    release: string;
    manifest: Readonly<import("./deployment-manifest.js").InstalledDeploymentManifest>;
    definition: Readonly<import("./installed-receiver-registration.js").InstalledReceiverDefinition>;
    privateKey: import("crypto").KeyObject;
    publicKey: import("crypto").KeyObject;
    peerHelper: string;
    assertCurrent: () => void;
    close(): void;
}>;
export type InstalledReceiverLifetime = ReturnType<typeof createInstalledReceiverLifetime>;
