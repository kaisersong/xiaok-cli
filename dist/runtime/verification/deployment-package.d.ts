export interface DeploymentPackageFile {
    readonly path: string;
    readonly size: number;
    readonly sha256: string;
    readonly executable: boolean;
}
export interface DeploymentPackageInventory {
    readonly schemaVersion: 1;
    readonly files: readonly DeploymentPackageFile[];
    readonly packageHash: string;
}
/** Packaging census only. A matching hash never establishes protected OS ownership or engine qualification. */
export declare function snapshotDeploymentPackage(inputRoot: string): DeploymentPackageInventory;
export declare function parseDeploymentPackageInventory(inventory: unknown): DeploymentPackageInventory;
export declare function verifyDeploymentPackage(root: string, inventory: unknown): void;
