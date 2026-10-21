import type { Database } from 'better-sqlite3';
import type { InstalledDeploymentManifest } from './deployment-manifest.js';
export declare function assertStorageOwnerSchema(database: Database, manifest: Readonly<InstalledDeploymentManifest>): void;
export declare function prepareStorageOwnerSchema(database: Database): void;
export declare function recordKSwarmStorageFeature(database: Database): void;
