import type { ToolDefinition } from '../../types.js';
export interface CapabilityRecord {
    kind: 'tool' | 'skill' | 'agent' | 'mcp';
    name: string;
    description: string;
    inputSchema?: ToolDefinition['inputSchema'];
    execute?: (input: Record<string, unknown>) => Promise<string>;
}
export declare class CapabilityRegistry {
    private readonly records;
    register(record: CapabilityRecord): void;
    unregister(name: string): void;
    get(name: string): CapabilityRecord | undefined;
    search(query: string): CapabilityRecord[];
}
