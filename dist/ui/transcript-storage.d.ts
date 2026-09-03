import { PluginClaimLock, type PluginLockCapability } from '../platform/provider-store/plugin-claim-lock.js';
export type TranscriptArchivePhase = 'afterSegmentPublished' | 'afterRawRenamed' | 'afterPendingVerified' | 'afterManifestCommitted';
export interface TranscriptArchiveOptions {
    rootDir?: string;
    olderThanDays?: number;
    now?: number;
    onPhase?: (phase: TranscriptArchivePhase) => void | Promise<void>;
}
export interface TranscriptArchiveResult {
    status: 'archived' | 'already_archived' | 'archived_pending_cleanup';
    sessionId: string;
    sourceBytes: number;
    compressedBytes: number;
    bytesFreed: number;
    segmentCount: number;
}
export declare class TranscriptStorageError extends Error {
    readonly code: string;
    constructor(code: string, message: string, options?: ErrorOptions);
}
export interface TranscriptLine {
    line: string;
    lineNumber: number;
    terminated: boolean;
}
export type TranscriptReadPhase = 'afterManifestResolved';
export interface TranscriptReadOptions {
    onPhase?: (phase: TranscriptReadPhase) => void | Promise<void>;
}
export interface TranscriptSealOperations {
    open(path: string, flags: string): number;
    fsync(fd: number): void;
    close(fd: number): void;
}
interface TranscriptPaths {
    rootDir: string;
    raw: string;
    archiveDir: string;
    claimsDir: string;
}
export declare class TranscriptSessionLease {
    private readonly lock;
    private readonly capability;
    private released;
    constructor(lock: PluginClaimLock, capability: PluginLockCapability);
    close(): void;
}
export declare function defaultTranscriptRoot(): string;
export declare function transcriptPaths(sessionId: string, rootDir?: string): TranscriptPaths;
export declare function validateTranscriptSessionId(sessionId: string): void;
export declare function acquireTranscriptLease(sessionId: string, rootDir?: string, acquireTimeoutMs?: number): Promise<TranscriptSessionLease>;
export declare function prepareTranscriptWriter(sessionId: string, rootDir?: string): Promise<void>;
export declare function sealTranscriptWriter(sessionId: string, rootDir?: string, operations?: TranscriptSealOperations): void;
export declare function readTranscriptJsonValues(sessionId: string, rootDir?: string): unknown[];
export declare function iterateTranscriptLines(sessionId: string, rootDir?: string, options?: TranscriptReadOptions): AsyncGenerator<TranscriptLine>;
export declare function archiveTranscript(sessionId: string, options?: TranscriptArchiveOptions): Promise<TranscriptArchiveResult>;
export declare function isIncompleteJsonTail(input: string): boolean;
export {};
