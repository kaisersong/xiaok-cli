import type { Tool } from '../../types.js';
const tools = new WeakMap<Tool, { execute: Tool['execute']; permission: Tool['permission']; definition: string }>();
/** Host factory only. Serializing a tool or merely naming it subagent grants nothing. */
export function brandObservationDelegationTool(tool: Tool): Tool {
  tools.set(tool, { execute: tool.execute, permission: tool.permission, definition: JSON.stringify(tool.definition) });
  return tool;
}
export function isObservationDelegationTool(tool: Tool): boolean {
  const binding = tools.get(tool);
  return !!binding && binding.execute === tool.execute && binding.permission === tool.permission && binding.definition === JSON.stringify(tool.definition);
}
