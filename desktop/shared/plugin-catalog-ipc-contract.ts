import { z } from 'zod';
export const PLUGIN_MCP_ERROR_SCHEMA = z.object({
  category: z.enum(['python_version_too_old', 'python_module_missing']).nullable(), message: z.string(),
  detectedVersion: z.string().optional(), requiredVersion: z.string().optional(), command: z.string().optional(), missingModule: z.string().optional(),
}).passthrough();
export const PLUGIN_MCP_SERVER_SCHEMA = z.object({
  name: z.string(), pluginName: z.string(), toolCount: z.number().finite(), connected: z.boolean(), enabled: z.boolean(),
  lastError: z.string().optional(), lastErrorDetail: PLUGIN_MCP_ERROR_SCHEMA.optional(),
}).passthrough();
export const AVAILABLE_PLUGIN_SCHEMA = z.object({
  name: z.string(), display_name: z.string(), description: z.string(), version: z.string(), installed: z.boolean(),
  category: z.string().optional(), keywords: z.array(z.string()).optional(), repo: z.string().optional(), path: z.string().optional(),
  dependencies: z.object({ runtime: z.string().optional(), install: z.string().optional(), test: z.string().optional() }).passthrough().optional(),
}).passthrough();
export const PLUGIN_DEPENDENCY_STATUS_SCHEMA = z.object({
  pluginName: z.string(), dependencyId: z.string(), displayName: z.string(), pluginInstalled: z.boolean().optional(),
  state: z.enum(['ready', 'missing', 'needs_permission', 'degraded', 'unsupported']), code: z.string(),
  resolvedBinary: z.string().optional(), version: z.string().optional(), detail: z.string().optional(),
  canInstall: z.boolean(), canUpdate: z.boolean(), canDiagnose: z.boolean(),
  task: z.object({ taskId: z.string(), dependencyId: z.string(), state: z.enum(['running', 'cancelling']) }).passthrough().optional(),
}).passthrough();
export const PLUGIN_CATALOG_INPUT_SCHEMAS = { listPluginMcpServers: z.tuple([]), listAvailablePlugins: z.tuple([]), listPluginDependencyStatuses: z.tuple([]) } as const;
export const PLUGIN_CATALOG_OUTPUT_SCHEMAS = { listPluginMcpServers: z.array(PLUGIN_MCP_SERVER_SCHEMA), listAvailablePlugins: z.array(AVAILABLE_PLUGIN_SCHEMA), listPluginDependencyStatuses: z.array(PLUGIN_DEPENDENCY_STATUS_SCHEMA) } as const;
export type PluginCatalogMethod = keyof typeof PLUGIN_CATALOG_INPUT_SCHEMAS;
export type PluginMcpServerDto = z.infer<typeof PLUGIN_MCP_SERVER_SCHEMA>;
export type AvailablePluginDto = z.infer<typeof AVAILABLE_PLUGIN_SCHEMA>;
export type PluginDependencyStatusDto = z.infer<typeof PLUGIN_DEPENDENCY_STATUS_SCHEMA>;
