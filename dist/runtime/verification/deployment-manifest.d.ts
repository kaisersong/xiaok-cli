export type InstalledDeploymentManifest = ({
    readonly version: 2;
    readonly completionOwnerSchema?: never;
} | {
    readonly version: 3;
    readonly completionOwnerSchema: 2;
}) & {
    readonly authorityId: string;
    readonly publicKeyPem: string;
    readonly packageHash: string;
    readonly serviceUid: number;
    readonly allowedUserIds: readonly number[];
};
/** Strict root-owned deployment data; parsing is not proof of root ownership or installation. */
export declare function parseInstalledDeploymentManifest(raw: unknown): Readonly<InstalledDeploymentManifest>;
