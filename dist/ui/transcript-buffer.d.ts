export type TranscriptBufferEntry = {
    kind: 'user' | 'assistant' | 'thinking';
    text: string;
} | {
    kind: 'tool_use';
    agentId: string;
    name: string;
    summary: string;
} | {
    kind: 'tool_result';
    agentId: string;
    name: string;
    content: string;
    isError: boolean;
} | {
    kind: 'image';
    mediaType: string;
    width?: number;
    height?: number;
} | {
    kind: 'command_output';
    command: string;
    output: string;
} | {
    kind: 'system';
    text: string;
};
export declare const TRANSCRIPT_ENTRY_BYTE_LIMIT: number;
export declare const TRANSCRIPT_SESSION_BYTE_LIMIT: number;
export interface TranscriptBufferOptions {
    entryByteLimit?: number;
    sessionByteLimit?: number;
    onError?: (error: unknown) => void;
}
export declare class TranscriptBuffer {
    private entries;
    private totalBytes;
    private readonly entryByteLimit;
    private readonly sessionByteLimit;
    private readonly onError?;
    constructor(options?: TranscriptBufferOptions);
    /**
     * Never throws: an exception here would surface to the model as a tool error
     * because onToolObserved is awaited inside ToolRegistry.execute's try block.
     */
    record(entry: TranscriptBufferEntry): void;
    getEntries(): TranscriptBufferEntry[];
    getTotalBytes(): number;
    isEmpty(): boolean;
    clear(): void;
    private cap;
    private evictIfNeeded;
}
export declare function recordToolObservation(buffer: TranscriptBuffer, event: {
    agentId: string;
    toolName: string;
    result: string;
    ok: boolean;
}): void;
export declare function renderTranscriptText(entries: TranscriptBufferEntry[]): string;
