/**
 * MCP Server Configuration Loading
 *
 * 从两个源加载 MCP server 配置：
 * 1. ~/.xiaok/settings.json (user-level)
 * 2. Plugin manifests (project/user-level)
 *
 * 合并策略：plugin 覆盖 settings 的同名 server
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getConfigDir } from '../../utils/config.js';
/**
 * 从 ~/.xiaok/settings.json 加载 MCP servers
 */
export function loadSettingsMcpServers() {
    const settingsPath = join(getConfigDir(), 'settings.json');
    if (!existsSync(settingsPath)) {
        return {};
    }
    try {
        const raw = JSON.parse(readFileSync(settingsPath, 'utf8'));
        const mcpServers = raw.mcpServers;
        if (!mcpServers || typeof mcpServers !== 'object') {
            return {};
        }
        // 验证每个 server config
        for (const [name, config] of Object.entries(mcpServers)) {
            validateMcpServerConfig(name, config);
        }
        return mcpServers;
    }
    catch (error) {
        console.warn(`Failed to load MCP servers from settings.json: ${error}`);
        return {};
    }
}
/**
 * 校验 MCP server config 格式
 */
export function validateMcpServerConfig(name, config) {
    if (!config.type) {
        throw new Error(`MCP server "${name}" missing required "type" field`);
    }
    if (config.type === 'stdio' && !config.command) {
        throw new Error(`MCP server "${name}" (stdio) missing required "command" field`);
    }
    if ((config.type === 'sse' || config.type === 'http' || config.type === 'ws') && !config.url) {
        throw new Error(`MCP server "${name}" (${config.type}) missing required "url" field`);
    }
}
/**
 * 从 plugin runtime 中提取 MCP servers
 */
export function loadPluginMcpServers(pluginRuntime) {
    return pluginRuntime.plugins
        .flatMap((plugin) => plugin.mcpServers ?? []);
}
/**
 * 合并 settings 和 plugin 的 MCP server 配置
 * 策略：plugin 覆盖 settings 的同名 server
 */
export function mergeMcpServerConfigs(settingsServers, pluginServers) {
    const merged = new Map();
    // 1. 先加入 settings servers（低优先级）
    for (const [name, config] of Object.entries(settingsServers)) {
        merged.set(name, { name, ...config });
    }
    // 2. 再加入 plugin servers（高优先级，覆盖同名）
    for (const server of pluginServers) {
        merged.set(server.name, server);
    }
    // 3. 转换为数组
    return Array.from(merged.values());
}
