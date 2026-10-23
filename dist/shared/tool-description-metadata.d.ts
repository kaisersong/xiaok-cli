import type { ToolDefinition } from '../types.js';
/** Descriptions only: never an execution, permission, or retry contract. */
export interface ToolDescriptionMetadata {
    outputSchema?: unknown;
    effect?: 'none' | 'read' | 'write' | 'execute' | 'mixed' | 'unknown';
    idempotency?: 'idempotent' | 'non-idempotent' | 'unknown';
}
export interface ToolDiscovery {
    coreDefinition: ToolDefinition;
    metadata?: Readonly<ToolDescriptionMetadata>;
}
/** Capture only explicitly registered own data, without invoking getters or Proxy traps. */
export declare function captureToolDescriptionMetadata(raw?: ToolDescriptionMetadata): Readonly<ToolDescriptionMetadata> | undefined;
export declare const BUILTIN_READ_DESCRIPTION: Readonly<ToolDescriptionMetadata>;
