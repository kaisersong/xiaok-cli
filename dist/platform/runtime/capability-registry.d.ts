import { type ToolDescriptionMetadata } from '../../shared/tool-description-metadata.js';
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
    register(record: CapabilityRecord, owner?: object, description?: ToolDescriptionMetadata): void;
    unregister(name: string, owner?: object): void;
    unregisterOwner(owner: object): void;
    get(name: string): CapabilityRecord | undefined;
    getDiscovery(name: string): {
        coreRecord: CapabilityRecord;
        metadata?: Readonly<ToolDescriptionMetadata>;
    } | undefined;
    searchDiscoveries(query: string): {
        coreRecord: CapabilityRecord;
        metadata?: Readonly<ToolDescriptionMetadata>;
    }[];
    search(query: string): CapabilityRecord[];
}
