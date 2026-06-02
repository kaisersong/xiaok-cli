/**
 * MCP Server Configuration Loading
 *
 * 从两个源加载 MCP server 配置：
 * 1. ~/.xiaok/settings.json (user-level)
 * 2. Plugin manifests (project/user-level)
 *
 * 合并策略：plugin 覆盖 settings 的同名 server,同名冲突在 conflicts 中可观测。
 */
import type { PlatformPluginRuntimeState } from '../plugins/runtime.js';
import type { SettingsMcpServers, McpServerConfig, McpServerSource, NamedMcpServerConfig } from './types.js';
/**
 * 从 ~/.xiaok/settings.json 加载 MCP servers
 */
export declare function loadSettingsMcpServers(): SettingsMcpServers;
/**
 * 校验 MCP server config 格式
 */
export declare function validateMcpServerConfig(name: string, config: McpServerConfig): void;
/**
 * 从 plugin runtime 中提取 MCP servers,并附加 source 元数据。
 */
export declare function loadPluginMcpServers(pluginRuntime: PlatformPluginRuntimeState): NamedMcpServerConfig[];
export interface McpServerConfigConflict {
    name: string;
    winner: McpServerSource;
    loser: McpServerSource;
}
export interface MergedMcpServerConfigs {
    servers: NamedMcpServerConfig[];
    conflicts: McpServerConfigConflict[];
}
/**
 * 合并 settings 和 plugin 的 MCP server 配置。
 * 策略:plugin 覆盖 settings 的同名 server;同名 plugin 之间后到者胜。
 * 任何同名覆盖都会进 conflicts,由调用方写入 health。
 */
export declare function mergeMcpServerConfigs(settingsServers: SettingsMcpServers, pluginServers: NamedMcpServerConfig[]): MergedMcpServerConfigs;
