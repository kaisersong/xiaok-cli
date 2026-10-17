import type { ToolDefinition } from '../../types.js';
import type { CapabilityRecord } from '../../platform/runtime/capability-registry.js';

export interface ToolSearchEntry {
  canonicalId: string;
  definition: ToolDefinition;
}

const LEGACY_TOOL_ALIASES: Record<string, string> = {
  bash: 'bash',
  edit: 'edit',
  glob: 'glob',
  grep: 'grep',
  read: 'read',
  write: 'write',
  webfetch: 'web_fetch',
  'web-fetch': 'web_fetch',
  web_fetch: 'web_fetch',
  websearch: 'web_search',
  'web-search': 'web_search',
  web_search: 'web_search',
  toolsearch: 'tool_search',
  'tool-search': 'tool_search',
  tool_search: 'tool_search',
  installskill: 'install_skill',
  'install-skill': 'install_skill',
  install_skill: 'install_skill',
  uninstallskill: 'uninstall_skill',
  'uninstall-skill': 'uninstall_skill',
  uninstall_skill: 'uninstall_skill',
};

export function getCanonicalToolId(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return '';
  }

  const normalized = trimmed.toLowerCase();
  return LEGACY_TOOL_ALIASES[normalized] ?? normalized;
}

export function buildToolSearchEntry(definition: ToolDefinition): ToolSearchEntry {
  return {
    canonicalId: getCanonicalToolId(definition.name),
    definition,
  };
}

export function buildCapabilityToolDefinition(record: CapabilityRecord): ToolDefinition {
  return {
    name: record.name,
    description: record.description,
    inputSchema: record.inputSchema ?? { type: 'object', properties: {} },
  };
}

export function dedupeToolSearchEntries(entries: ToolSearchEntry[]): ToolDefinition[] {return dedupeToolSearchCandidates(entries).map(entry=>entry.definition);}
export function selectToolEntries(entries: ToolSearchEntry[], names: string[]): ToolDefinition[] {return selectToolSearchCandidates(entries,names).map(entry=>entry.definition);}

/** Preserve the whole selected registration, including host-only sidecars. */
export function dedupeToolSearchCandidates<T extends ToolSearchEntry>(entries:T[]):T[]{
 const merged=new Map<string,T>();for(const entry of entries)if(!merged.has(entry.canonicalId))merged.set(entry.canonicalId,entry);return [...merged.values()];
}
export function selectToolSearchCandidates<T extends ToolSearchEntry>(entries:T[],names:string[]):T[]{
 const lookup=new Map(entries.map(entry=>[entry.canonicalId,entry] as const));const result:T[]=[];for(const name of names){const entry=lookup.get(getCanonicalToolId(name));if(entry)result.push(entry);}return result;
}
