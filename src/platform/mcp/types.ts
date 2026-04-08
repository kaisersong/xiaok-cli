/**
 * MCP Server Configuration Types
 *
 * 对齐 Claude Code 的 McpServerConfigSchema
 * 支持 stdio/sse/http/ws 四种 transport
 */

/**
 * Stdio MCP Server Configuration
 * 启动子进程并通过 stdio 通信
 */
export interface McpStdioServerConfig {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * SSE MCP Server Configuration
 * Server-Sent Events transport
 */
export interface McpSSEServerConfig {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

/**
 * HTTP MCP Server Configuration
 * Streamable HTTP transport
 */
export interface McpHTTPServerConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

/**
 * WebSocket MCP Server Configuration
 */
export interface McpWebSocketServerConfig {
  type: 'ws';
  url: string;
}

/**
 * MCP Server Configuration (union type)
 */
export type McpServerConfig =
  | McpStdioServerConfig
  | McpSSEServerConfig
  | McpHTTPServerConfig
  | McpWebSocketServerConfig;

/**
 * Plugin Manifest 中的 MCP Server 配置
 * 必须显式声明 name 字段
 */
export type PluginManifestMcpServer = McpServerConfig & {
  name: string;
};

/**
 * Settings.json 中的 MCP Servers 配置
 * 使用 server name 作为 key（对齐 CC 格式）
 */
export interface SettingsMcpServers {
  [serverName: string]: McpServerConfig;
}

/**
 * Named MCP Server Config (用于合并后的配置)
 */
export type NamedMcpServerConfig = McpServerConfig & {
  name: string;
};