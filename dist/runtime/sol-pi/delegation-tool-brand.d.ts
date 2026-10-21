import type { Tool } from '../../types.js';
/** Host factory only. Serializing a tool or merely naming it subagent grants nothing. */
export declare function brandObservationDelegationTool(tool: Tool): Tool;
export declare function isObservationDelegationTool(tool: Tool): boolean;
