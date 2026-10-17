import {captureToolDescriptionMetadata,type ToolDescriptionMetadata} from '../../shared/tool-description-metadata.js';
import type { ToolDefinition } from '../../types.js';

export interface CapabilityRecord {
  kind: 'tool' | 'skill' | 'agent' | 'mcp';
  name: string;
  description: string;
  inputSchema?: ToolDefinition['inputSchema'];
  execute?: (input: Record<string, unknown>) => Promise<string>;
}

export class CapabilityRegistry {
  private readonly records = new Map<string, Map<object, {coreRecord:CapabilityRecord;metadata?:Readonly<ToolDescriptionMetadata>}>>();

  register(record: CapabilityRecord, owner: object = this, description?:ToolDescriptionMetadata): void {
    const metadata=captureToolDescriptionMetadata(description);
    const registrations = this.records.get(record.name) ?? new Map<object, {coreRecord:CapabilityRecord;metadata?:Readonly<ToolDescriptionMetadata>}>();
    // Refresh replaces this owner's entry rather than retaining old closures.
    registrations.delete(owner);
    registrations.set(owner, Object.freeze(metadata ? {coreRecord:record,metadata} : {coreRecord:record}));
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
    return registrations ? [...registrations.values()].at(-1)?.coreRecord : undefined;
  }

  getDiscovery(name:string):{coreRecord:CapabilityRecord;metadata?:Readonly<ToolDescriptionMetadata>}|undefined {
    const registrations=this.records.get(name);return registrations ? [...registrations.values()].at(-1) : undefined;
  }

  searchDiscoveries(query:string) {
    const normalized=query.trim().toLowerCase();return [...this.records.keys()].map(name=>this.getDiscovery(name)!).filter(({coreRecord:record})=>!normalized||record.name.toLowerCase().includes(normalized)||record.description.toLowerCase().includes(normalized));
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
