import { chmodSync } from 'node:fs';
export declare const ACTIVITY_STORAGE_NAMES: {
    readonly database: "conversation-activity.sqlite";
    readonly ownerPrefix: "activity-owner.";
    readonly config: "activity-owner.config.json";
    readonly log: "activity-owner.log";
    readonly status: "activity-owner.status.json";
    readonly credentials: "activity-owner.credentials.json";
    readonly supervision: "activity-source-supervision.json";
    readonly kswarmLog: "activity-kswarm.log";
    readonly brokerLog: "activity-broker.log";
    readonly endpoints: "activity-mcp-endpoints.json";
    readonly notice: "first-start-notice-shown";
    readonly snapshots: "snapshots";
};
export declare function activityStorageLayout(root: string): 'dedicated' | 'shared';
export declare function isActivityStorageEntry(name: string): boolean;
export declare function chmodPrivateActivityFile(path: string): void;
/** Tighten legacy storage before any persistent write; never follow links. */
export declare function secureActivityStorage(root: string, options?: {
    chmodSync?: typeof chmodSync;
    maxEntries?: number;
    platform?: NodeJS.Platform;
}): void;
/** Check existing ancestors before recursive mkdir can write through a link. */
export declare function createPrivateActivityDirectory(root: string): void;
