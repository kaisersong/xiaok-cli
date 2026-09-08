import type { Tool } from '../../types.js';
export declare const bashTool: Tool;
/** Installed only by the interactive CLI host, before sandbox wrapping. */
export declare function createInteractiveBashTool(run: Tool['execute']): Tool;
