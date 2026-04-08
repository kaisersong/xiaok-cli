/**
 * MCP Server Configuration Loading
 *
 * 从两个源加载 MCP server 配置：
 * 1. ~/.xiaok/settings.json (user-level)
 * 2. Plugin manifests (project/user-level)
 *
 * 合并策略：plugin 覆盖 settings 的同名 server
 */
import type { PlatformPluginRuntimeState } from '../plugins/runtime.js';
import type { SettingsMcpServers, McpServerConfig, NamedMcpServerConfig } from './types.js';
/**
 * 从 ~/.xiaok/settings.json 加载 MCP servers
 */
export declare function loadSettingsMcpServers(): SettingsMcpServers;
/**
 * 校验 MCP server config 格式
 */
export declare function validateMcpServerConfig(name: string, config: McpServerConfig): void;
/**
 * 从 plugin runtime 中提取 MCP servers
 */
export declare function loadPluginMcpServers(pluginRuntime: PlatformPluginRuntimeState): NamedMcpServerConfig[];
/**
 * 合并 settings 和 plugin 的 MCP server 配置
 * 策略：plugin 覆盖 settings 的同名 server
 */
export declare function mergeMcpServerConfigs(settingsServers: SettingsMcpServers, pluginServers: NamedMcpServerConfig[]): NamedMcpServerConfig[];
