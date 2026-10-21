// UNREVIEWED CANDIDATE — install at desktop/shared only after owner DESIGN approval.
import { z } from 'zod';
import { CHANNEL_READONLY_OUTPUT_SCHEMA, MCP_INSTALLS_READONLY_OUTPUT_SCHEMA } from './channel-mcp-readonly-ipc-contract.js';
export const CHANNEL_MCP_MUTATION_METHODS = ['createChannel', 'updateChannel', 'deleteChannel', 'testChannel', 'createMCPInstall', 'updateMCPInstall', 'deleteMCPInstall'] as const;
export type ChannelMcpMutationMethod = typeof CHANNEL_MCP_MUTATION_METHODS[number];
const key = z.string().min(1).refine(v => !['__proto__', 'prototype', 'constructor'].includes(v));
const credentials = { appId: z.string().optional(), appSecret: z.string().optional(), token: z.string().optional(), botToken: z.string().optional(), chatId: z.string().optional() };
const channelFields = { name: z.string(), webhookUrl: z.string().optional(), ...credentials };
const createChannel = z.object({ type: key, ...channelFields }).strict();
const updateChannel = z.object({ type: key.optional(), ...channelFields, enabled: z.boolean() }).partial().strict();
const mcpFields = { name: z.string(), source: z.enum(['npm', 'github', 'local']), command: z.string().min(1), args: z.array(z.string()).optional() };
const createMcp = z.object(mcpFields).strict();
const updateMcp = z.object({ ...mcpFields, enabled: z.boolean() }).partial().strict();
export const CHANNEL_MCP_MUTATION_INPUTS = {
  createChannel: z.tuple([createChannel]), updateChannel: z.tuple([key, updateChannel]), deleteChannel: z.tuple([key]), testChannel: z.tuple([key]),
  createMCPInstall: z.tuple([createMcp]), updateMCPInstall: z.tuple([key, updateMcp]), deleteMCPInstall: z.tuple([key]),
} as const;
const channel = CHANNEL_READONLY_OUTPUT_SCHEMA.element.extend({ createdAt: z.number().finite(), updatedAt: z.number().finite() });
// Mutation ACK retains original toMCPView columns; stored/read-only rows retain passthrough metadata.
const mcp = MCP_INSTALLS_READONLY_OUTPUT_SCHEMA.element.strict().extend({ createdAt: z.number().finite() });
export const CHANNEL_MCP_MUTATION_OUTPUTS = {
  createChannel: channel, updateChannel: channel, deleteChannel: z.undefined(),
  testChannel: z.object({ success: z.boolean(), latencyMs: z.number().finite().nonnegative().optional(), error: z.string().optional() }).strict(),
  createMCPInstall: mcp, updateMCPInstall: mcp, deleteMCPInstall: z.undefined(),
} as const;
export const CHANNEL_MCP_MUTATION_RISKS = {
  createChannel: ['fs-write'], updateChannel: ['fs-write'], deleteChannel: ['fs-write', 'fs-delete'], testChannel: ['fs-read', 'network'],
  createMCPInstall: ['fs-write-userData'], updateMCPInstall: ['fs-write-userData'], deleteMCPInstall: ['fs-write-userData', 'fs-delete'],
} as const;
