/**
 * MCP Server Configuration Loading
 *
 * 从两个源加载 MCP server 配置：
 * 1. ~/.xiaok/settings.json (user-level)
 * 2. Plugin manifests (project/user-level)
 *
 * 合并策略：plugin 覆盖 settings 的同名 server,同名冲突在 conflicts 中可观测。
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
 * 从 plugin runtime 中提取 MCP servers,并附加 source 元数据。
 */
export function loadPluginMcpServers(pluginRuntime) {
    const out = [];
    for (const plugin of pluginRuntime.plugins) {
        if (!plugin.mcpServers)
            continue;
        for (const server of plugin.mcpServers) {
            out.push({
                ...server,
                source: {
                    origin: 'plugin',
                    pluginName: plugin.name,
                    pluginDir: plugin.rootDir,
                },
            });
        }
    }
    return out;
}
/**
 * 合并 settings 和 plugin 的 MCP server 配置。
 * 策略:plugin 覆盖 settings 的同名 server;同名 plugin 之间后到者胜。
 * 任何同名覆盖都会进 conflicts,由调用方写入 health。
 */
export function mergeMcpServerConfigs(settingsServers, pluginServers) {
    const merged = new Map();
    const conflicts = [];
    for (const [name, config] of Object.entries(settingsServers)) {
        merged.set(name, {
            name,
            ...config,
            source: { origin: 'settings' },
        });
    }
    for (const server of pluginServers) {
        const incomingSource = server.source ?? { origin: 'plugin' };
        const prev = merged.get(server.name);
        if (prev) {
            conflicts.push({
                name: server.name,
                winner: incomingSource,
                loser: prev.source ?? { origin: 'settings' },
            });
        }
        merged.set(server.name, server);
    }
    return { servers: Array.from(merged.values()), conflicts };
}
