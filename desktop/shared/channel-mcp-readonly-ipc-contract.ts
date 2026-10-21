import { z } from 'zod';
export const CHANNEL_MCP_READONLY_METHODS = ['listChannels', 'listMCPInstalls'] as const;
export type ChannelMcpReadonlyMethod = typeof CHANNEL_MCP_READONLY_METHODS[number];
export const CHANNEL_MCP_READONLY_INPUT_SCHEMA = z.tuple([]);
export const CHANNEL_READONLY_OUTPUT_SCHEMA = z.array(z.object({
  id:z.string(),type:z.string(),name:z.string(),webhookUrl:z.string().optional(),enabled:z.boolean(),createdAt:z.number(),updatedAt:z.number(),
}).strict());
export const MCP_INSTALLS_READONLY_OUTPUT_SCHEMA = z.array(z.object({
  id:z.string(),name:z.string(),source:z.string(),command:z.string(),args:z.array(z.string()).optional(),enabled:z.boolean(),createdAt:z.number(),
}).passthrough());
export const STORED_CHANNELS_READONLY_SCHEMA = z.record(z.object({
  name:z.string().optional(),enabled:z.boolean().optional(),webhookUrl:z.string().optional(),sendMsgUrl:z.string().optional(),
}).passthrough());
export const CHANNEL_MCP_READONLY_OUTPUT_SCHEMAS = {listChannels:CHANNEL_READONLY_OUTPUT_SCHEMA,listMCPInstalls:MCP_INSTALLS_READONLY_OUTPUT_SCHEMA} as const;
export type ChannelReadonlyView = z.infer<typeof CHANNEL_READONLY_OUTPUT_SCHEMA>[number];
export type McpInstallReadonlyView = z.infer<typeof MCP_INSTALLS_READONLY_OUTPUT_SCHEMA>[number];
