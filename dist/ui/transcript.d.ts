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
}
export interface TranscriptAnalysis {
    slashPromptGrowth: number;
    approvalTitleRepeats: number;
}
export declare function normalizeTranscriptChunk(chunk: string): string;
export declare class FileTranscriptLogger implements TranscriptLogger {
    private readonly sessionId;
    private readonly rootDir;
    constructor(sessionId: string, rootDir?: string);
    get path(): string;
    record(event: TranscriptEvent): void;
    recordOutput(stream: 'stdout' | 'stderr', chunk: string): void;
    private getFilePath;
}
export declare function loadTranscriptEvents(sessionId: string, rootDir?: string): TranscriptEvent[];
export declare function analyzeTranscriptEvents(events: TranscriptEvent[]): TranscriptAnalysis;
