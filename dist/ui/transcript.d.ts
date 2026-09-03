import { archiveTranscript, TranscriptStorageError, type TranscriptArchiveOptions, type TranscriptArchivePhase, type TranscriptArchiveResult, type TranscriptReadOptions } from './transcript-storage.js';
export { archiveTranscript, TranscriptStorageError, type TranscriptArchiveOptions, type TranscriptArchivePhase, type TranscriptArchiveResult, type TranscriptReadOptions, };
export type TranscriptEvent = {
    type: 'input_key';
    key: string;
    timestamp: number;
} | {
    type: 'input_read_attach';
    timestamp: number;
} | {
    type: 'input_read_detach';
    reason: 'submit' | 'cancel' | 'eof';
    timestamp: number;
} | {
    type: 'input_submit';
    value: string;
    timestamp: number;
} | {
    type: 'input_queue_submit';
    value: string;
    timestamp: number;
} | {
    type: 'input_queue_replace';
    oldValue: string;
    newValue: string;
    timestamp: number;
} | {
    type: 'input_queue_edit';
    value: string;
    timestamp: number;
} | {
    type: 'input_queue_cancel';
    value?: string;
    timestamp: number;
} | {
    type: 'input_queue_dequeue';
    value: string;
    timestamp: number;
} | {
    type: 'busy_capture_attach';
    timestamp: number;
} | {
    type: 'busy_capture_detach';
    reason: 'pause' | 'stop' | 'disabled' | 'ui_error';
    timestamp: number;
} | {
    type: 'permission_prompt_open';
    toolName: string;
    timestamp: number;
} | {
    type: 'permission_prompt_navigate';
    direction: 'up' | 'down';
    timestamp: number;
} | {
    type: 'permission_prompt_decision';
    action: string;
    timestamp: number;
} | {
    type: 'output';
    stream: 'stdout' | 'stderr';
    raw: string;
    normalized: string;
    timestamp: number;
};
export interface TranscriptLogger {
    record(event: TranscriptEvent): void;
    recordOutput(stream: 'stdout' | 'stderr', chunk: string): void;
    beginSuppress(): void;
    endSuppress(): void;
    close(): void;
}
export interface TranscriptAnalysis {
    eventCount: number;
    slashPromptGrowth: number;
    approvalTitleRepeats: number;
    warnings: TranscriptAnalysisWarning[];
}
export interface TranscriptAnalysisWarning {
    code: 'truncatedTail';
    line: number;
}
export declare function normalizeTranscriptChunk(chunk: string): string;
export declare class FileTranscriptLogger implements TranscriptLogger {
    private readonly sessionId;
    private readonly rootDir;
    private readonly lease;
    private suppressDepth;
    private closed;
    private readonly exitHandler;
    private constructor();
    static open(sessionId: string, rootDir?: string): Promise<FileTranscriptLogger>;
    get path(): string;
    beginSuppress(): void;
    endSuppress(): void;
    record(event: TranscriptEvent): void;
    recordOutput(stream: 'stdout' | 'stderr', chunk: string): void;
    close(): void;
    private getFilePath;
}
export declare function loadTranscriptEvents(sessionId: string, rootDir?: string): TranscriptEvent[];
export declare function analyzeTranscriptEvents(events: TranscriptEvent[]): TranscriptAnalysis;
export declare function analyzeTranscriptFileStreaming(sessionId: string, rootDir?: string, options?: TranscriptReadOptions): Promise<TranscriptAnalysis>;
