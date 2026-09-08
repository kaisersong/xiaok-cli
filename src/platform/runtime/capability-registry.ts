import type { ToolDefinition } from '../../types.js';

export interface CapabilityRecord {
  kind: 'tool' | 'skill' | 'agent' | 'mcp';
  name: string;
  description: string;
  inputSchema?: ToolDefinition['inputSchema'];
  execute?: (input: Record<string, unknown>) => Promise<string>;
}

export class CapabilityRegistry {
  private readonly records = new Map<string, Map<object, CapabilityRecord>>();

  register(record: CapabilityRecord, owner: object = this): void {
    const registrations = this.records.get(record.name) ?? new Map<object, CapabilityRecord>();
    // Refresh replaces this owner's entry rather than retaining old closures.
    registrations.delete(owner);
    registrations.set(owner, record);
    this.records.set(record.name, registrations);
  }

  unregister(name: string, owner?: object): void {
    if (!owner) {
      this.records.delete(name);
      return;
    }
    const registrations = this.records.get(name);
    registrations?.delete(owner);
    if (registrations?.size === 0) this.records.delete(name);
  }

  unregisterOwner(owner: object): void {
    for (const [name, registrations] of this.records) {
      registrations.delete(owner);
      if (registrations.size === 0) this.records.delete(name);
    }
  }

  get(name: string): CapabilityRecord | undefined {
    const registrations = this.records.get(name);
    return registrations ? [...registrations.values()].at(-1) : undefined;
  }

  search(query: string): CapabilityRecord[] {
    const normalized = query.trim().toLowerCase();
    return [...this.records.keys()].map((name) => this.get(name)!).filter((record) => {
      return !normalized
        || record.name.toLowerCase().includes(normalized)
        || record.description.toLowerCase().includes(normalized);
    });
  }
}
