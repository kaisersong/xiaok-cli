export declare const KIMI_SCHEMA_LIMITS: Readonly<{
    maxDepth: 64;
    maxInputNodes: 20000;
    maxRefExpansions: 4096;
    maxOutputNodes: 50000;
    maxOutputBytes: number;
    maxRequestToolCount: 256;
    maxRequestInputNodes: 100000;
    maxRequestOutputNodes: 200000;
    maxRequestToolBytes: number;
}>;
export type KimiSchemaLimitKind = 'depth' | 'input_nodes' | 'ref_expansions' | 'output_nodes' | 'output_bytes' | 'request_tool_count' | 'request_input_nodes' | 'request_output_nodes' | 'request_tool_bytes';
export declare class KimiToolSchemaError extends Error {
    readonly code: 'KIMI_SCHEMA_LIMIT_EXCEEDED' | 'KIMI_SCHEMA_TYPE_INFERENCE_FAILED' | 'KIMI_SCHEMA_INVALID_JSON_VALUE';
    readonly limitKind?: KimiSchemaLimitKind;
    readonly toolName?: string;
    constructor(code: KimiToolSchemaError['code'], options?: {
        limitKind?: KimiSchemaLimitKind;
        toolName?: string;
        message?: string;
    });
}
export interface NormalizedKimiSchema {
    schema: Record<string, unknown>;
    inputNodes: number;
    outputNodes: number;
    outputBytes: number;
}
export declare function normalizeKimiToolSchema(schema: Record<string, unknown>): NormalizedKimiSchema;
