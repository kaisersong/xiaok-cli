/**
 * Tool Pool Merging
 *
 * 合并 built-in tools 和 MCP tools，保证 ordering 稳定
 * 参考 CC: src/utils/toolPool.ts mergeAndFilterTools
 */
import partition from 'lodash-es/partition.js';
import uniqBy from 'lodash-es/uniqBy.js';
/**
 * 判断是否为 MCP tool
 * MCP tool name 格式: mcp__<server>__<tool>
 */
export function isMcpTool(tool) {
    return tool.definition.name.startsWith('mcp__');
}
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
export function mergeToolPools(builtInTools, mcpTools) {
    // 合并并去重（builtInTools 优先）
    const merged = uniqBy([...builtInTools, ...mcpTools], 'definition.name');
    // 分区：built-in vs MCP
    const [mcp, builtIn] = partition(merged, isMcpTool);
    // 按名称排序
    const byName = (a, b) => a.definition.name.localeCompare(b.definition.name);
    return [...builtIn.sort(byName), ...mcp.sort(byName)];
}
