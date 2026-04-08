/**
 * Tool Pool Merging
 *
 * 合并 built-in tools 和 MCP tools，保证 ordering 稳定
 * 参考 CC: src/utils/toolPool.ts mergeAndFilterTools
 */
import type { Tool } from '../../types.js';
/**
 * 判断是否为 MCP tool
 * MCP tool name 格式: mcp__<server>__<tool>
 */
export declare function isMcpTool(tool: Tool): boolean;
/**
 * 合并 built-in tools 和 MCP tools，保证 ordering 稳定
 *
 * 规则：
 * 1. Built-in tools 在前，MCP tools 在后
 * 2. 各自按名称排序（alphabetical）
 * 3. 去重：保留第一个出现的 tool
 *
 * 参考 CC: src/utils/toolPool.ts mergeAndFilterTools
 */
export declare function mergeToolPools(builtInTools: Tool[], mcpTools: Tool[]): Tool[];
