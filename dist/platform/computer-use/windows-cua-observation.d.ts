import type { McpRuntimeToolResult } from '../../ai/mcp/runtime/client.js';
/** Never reuses driver tokens across a host generation, even if raw IDs repeat. */
export declare class WindowsCuaObservationStore {
    private nonce;
    private foregroundGrants;
    private observations;
    reset(): void;
    recordOutcome(operation: string, input: Readonly<Record<string, unknown>>, result: McpRuntimeToolResult): void;
    identity(input: Readonly<Record<string, unknown>>): object | undefined;
    backgroundDragRequiresMouse(input: Readonly<Record<string, unknown>>): boolean;
    backgroundGestureRequiresMouse(operation: string, input: Readonly<Record<string, unknown>>): boolean;
    consume(input: Readonly<Record<string, unknown>>): void;
    record(input: Readonly<Record<string, unknown>>, result: McpRuntimeToolResult): McpRuntimeToolResult;
    prepare(action: string, input: Readonly<Record<string, unknown>>): Record<string, unknown>;
}
