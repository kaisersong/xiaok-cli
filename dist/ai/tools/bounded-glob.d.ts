export interface GlobSearchInput {
    patterns: string | string[];
    cwd: string;
    type?: 'file' | 'directory' | 'all';
    dot?: boolean;
    ignore?: string[];
    skipInaccessible?: boolean;
}
export interface GlobEntry {
    path: string;
    mtimeMs: number;
}
export declare const GLOB_LIMITS: Readonly<{
    maxEntries: 50000;
    maxDirectories: 10000;
    maxResults: 5000;
    maxPathBytes: number;
}>;
export type GlobLimits = {
    -readonly [K in keyof typeof GLOB_LIMITS]: number;
};
/** Host-only options can reduce budgets; tool arguments cannot increase them. */
export declare function createBoundedGlobRunner(options?: {
    limits?: Partial<GlobLimits>;
    timeoutMs?: number;
    maxWorkers?: number;
    workerUrl?: URL;
}): {
    readonly activeCount: number;
    search(input: GlobSearchInput, signal?: AbortSignal): Promise<GlobEntry[]>;
};
export declare const runBoundedGlob: (input: GlobSearchInput, signal?: AbortSignal) => Promise<GlobEntry[]>;
