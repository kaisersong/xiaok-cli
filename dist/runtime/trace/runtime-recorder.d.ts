import type { RuntimeEvent } from '../events.js';
import type { TraceBundleV1 } from './schema.js';
export interface RuntimeTraceRecorderOptions {
    rootDir: string;
    sessionId: string;
    cwd?: string;
    command?: string;
    version?: string;
    previewBytes?: number;
    persistOutputBytes?: number;
    now?: () => Date;
    onWarning?: (error: unknown) => void;
}
export declare class RuntimeTraceRecorder {
    private readonly options;
    private readonly writer;
    private readonly turns;
    private readonly events;
    private readonly toolCalls;
    private readonly artifacts;
    private readonly redactions;
    private toolOrdinal;
    private readonly activeToolIds;
    constructor(options: RuntimeTraceRecorderOptions);
    handleEvent(event: RuntimeEvent): void;
    flush(): Promise<string | null>;
    createBundle(): TraceBundleV1;
    private recordEvent;
    private recordToolStart;
    private recordToolOutput;
    private recordToolFailure;
    private recordArtifact;
    private appendEvent;
    private nextToolCallId;
    private nowIso;
}
export declare function createRuntimeTraceRecorderFromEnv(input: {
    sessionId: string;
    cwd?: string;
    command?: string;
    version?: string;
    onWarning?: (error: unknown) => void;
}): RuntimeTraceRecorder | null;
