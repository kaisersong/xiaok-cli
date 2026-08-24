import { TranscriptBuffer } from './transcript-buffer.js';
export type TranscriptPagerStatus = 'idle' | 'busy' | 'streaming' | 'permission';
export interface PagerSpawnResult {
    ok: boolean;
    exitCode?: number | null;
    signal?: NodeJS.Signals | null;
    error?: string;
}
export interface TranscriptPagerHost {
    getStatus(): TranscriptPagerStatus;
    getPager(): string | undefined;
    getPlatform(): NodeJS.Platform;
    lookupBinary(name: string): string | null;
    suspendInput(): {
        resume(): void;
    };
    endScrollRegion(): void;
    resumeScrollRegion(): void;
    spawnPager(argv: string[], filePath: string): Promise<PagerSpawnResult>;
    writeStdout(chunk: string): void;
    tempDir?: string;
    logDebug(message: string): void;
}
export interface TranscriptPagerResult {
    action: 'skipped' | 'pager' | 'printed' | 'error';
    reason?: string;
    exitCode?: number | null;
    signal?: NodeJS.Signals | null;
}
/** Quote-aware split so `PAGER="less -FX"` works without invoking a shell. */
export declare function parsePagerCommand(command: string): string[];
export declare function isLessFamilyBinary(binary: string): boolean;
export declare function buildPagerArgv(pagerEnv: string | undefined, isAvailable: (binary: string) => boolean): string[];
export declare function spawnPagerProcess(argv: string[], filePath: string): Promise<PagerSpawnResult>;
export declare function openTranscriptPager(opts: {
    buffer: TranscriptBuffer;
    host: TranscriptPagerHost;
}): Promise<TranscriptPagerResult>;
