import type { Database } from 'better-sqlite3';
import { type KeyObject } from 'node:crypto';
import { type InstalledDeploymentManifest } from './deployment-manifest.js';
export declare function assertInstalledControllerLifetime(value: object): void;
/** Actual fixed installed identity. No root/key/UID/DB override and no automatic
 * installation or replacement keys. Acquire before any execution recovery. */
export interface InstalledControllerLifetime {
    readonly base: string;
    readonly state: string;
    readonly release: string;
    readonly manifest: Readonly<InstalledDeploymentManifest>;
    readonly database: Database;
    readonly privateKey: KeyObject;
    readonly publicKey: KeyObject;
    readonly serviceEpoch: string;
    readonly peerHelper: string;
    assertCurrent(): void;
    close(): void;
}
export declare function createInstalledControllerLifetime(): Readonly<InstalledControllerLifetime>;
