import { chmodSync } from 'node:fs';
/** Tighten legacy storage before any persistent write; never follow links. */
export declare function secureActivityStorage(root: string, options?: {
    chmodSync?: typeof chmodSync;
    maxEntries?: number;
    platform?: NodeJS.Platform;
}): void;
/** Check existing ancestors before recursive mkdir can write through a link. */
export declare function createPrivateActivityDirectory(root: string): void;
