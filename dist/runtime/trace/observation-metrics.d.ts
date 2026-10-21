import type { Message, StreamChunk } from '../../types.js';
type Surface = 'cli' | 'cli-child' | 'desktop' | 'desktop-child';
type Stage = 'registry_visible' | 'registry_return' | 'history_result';
/** Host-only opt-in. Never an agent tool or a model-visible option. */
export declare function withObservationMetrics<T>(surface: Surface, action: () => Promise<T>, options?: {
    directory: string;
    maxEvents?: number;
}): Promise<T>;
export declare function observationMetricsEnabled(): boolean;
export declare function measureToolResult(stage: Stage, invocationId: string | undefined, tool: string, text: string): void;
export declare function measureCollector(input: {
    invocationId?: string;
    bytes: number;
    chunks: number;
    durationMs: number;
    terminalExited: boolean;
    interrupted: boolean;
}): void;
/** Observes the adapter call, not SDK-internal HTTP attempts or wire payloads. */
export declare function measureProviderStream(input: {
    messages: Message[];
    surface: string;
}, openStream: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>;
export {};
