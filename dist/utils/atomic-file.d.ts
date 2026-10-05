import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
export interface AtomicFileOperations {
    mkdirSync: typeof mkdirSync;
    openSync: typeof openSync;
    writeFileSync: typeof writeFileSync;
    fsyncSync: typeof fsyncSync;
    closeSync: typeof closeSync;
    renameSync: typeof renameSync;
    unlinkSync: typeof unlinkSync;
}
export interface AtomicWriteOptions {
    operations?: Partial<AtomicFileOperations>;
    platform?: NodeJS.Platform;
    tempName?: string;
    /** Protected publication barrier: unsupported directory flush is a hard failure. */
    requireDirectorySync?: boolean;
}
export type AtomicWriteFile = (targetPath: string, contents: string, options?: AtomicWriteOptions) => void;
export declare const writeFileAtomicallySync: AtomicWriteFile;
/** A publication barrier, not a best-effort durability hint. Failures must propagate. */
export declare function syncDirectoryTreeStrict(directoryPath: string, options?: Pick<AtomicWriteOptions, 'operations' | 'platform'>): void;
