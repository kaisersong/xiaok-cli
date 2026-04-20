import type { ToolDefinition } from '../../types.js';
import type { CapabilityRecord } from '../../platform/runtime/capability-registry.js';
export interface ToolSearchEntry {
    canonicalId: string;
    definition: ToolDefinition;
}
export declare function getCanonicalToolId(name: string): string;
export declare function buildToolSearchEntry(definition: ToolDefinition): ToolSearchEntry;
export declare function buildCapabilityToolDefinition(record: CapabilityRecord): ToolDefinition;
export declare function dedupeToolSearchEntries(entries: ToolSearchEntry[]): ToolDefinition[];
export declare function selectToolEntries(entries: ToolSearchEntry[], names: string[]): ToolDefinition[];
