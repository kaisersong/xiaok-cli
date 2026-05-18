import type { TraceBundleV1, TraceEvent, TraceArtifact, TraceRedaction, TraceToolCall } from './schema.js';
export interface TraceWriterOptions {
    rootDir: string;
    previewBytes?: number;
    persistOutputBytes?: number;
}
export declare class TraceBundleWriter {
    private readonly options;
    private readonly previewBytes;
    private readonly persistOutputBytes;
    constructor(options: TraceWriterOptions);
    appendEvent(_event: TraceEvent): void;
    recordToolCall(_call: TraceToolCall): void;
    recordArtifact(_artifact: TraceArtifact): void;
    persistLargeOutput(input: {
        toolCallId: string;
        content: string;
    }): {
        preview: string;
        redactedSha256: string;
        bytes: number;
        path?: string;
        redactions: TraceRedaction[];
    };
    writeBundle(bundle: TraceBundleV1): Promise<string>;
}
