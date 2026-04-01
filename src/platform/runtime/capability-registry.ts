import type { ToolDefinition } from '../../types.js';

export interface CapabilityRecord {
  kind: 'tool' | 'skill' | 'agent' | 'mcp';
  name: string;
  description: string;
  inputSchema?: ToolDefinition['inputSchema'];
  execute?: (input: Record<string, unknown>) => Promise<string>;
}

export class CapabilityRegistry {
  private readonly records = new Map<string, CapabilityRecord>();

  register(record: CapabilityRecord): void {
    this.records.set(record.name, record);
  }

  unregister(name: string): void {
    this.records.delete(name);
  }

  get(name: string): CapabilityRecord | undefined {
    return this.records.get(name);
  }

  search(query: string): CapabilityRecord[] {
    const normalized = query.trim().toLowerCase();
    return [...this.records.values()].filter((record) => {
      return !normalized
        || record.name.toLowerCase().includes(normalized)
        || record.description.toLowerCase().includes(normalized);
    });
  }
}
