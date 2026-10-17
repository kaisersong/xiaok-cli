// UNREVIEWED CANDIDATE — business owner only; not a new generic IPC/fs framework.
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { types } from 'node:util';
import { getConfigPath, saveConfig } from '../../src/utils/config.js';
import { DEFAULT_CONFIG, isValidLegacyProvider, type Config, type LegacyConfig } from '../../src/types.js';
import { normalizeConfig } from '../../src/ai/providers/normalize.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { STORED_CHANNELS_READONLY_SCHEMA, MCP_INSTALLS_READONLY_OUTPUT_SCHEMA } from '../shared/channel-mcp-readonly-ipc-contract.js';
import { CHANNEL_MCP_MUTATION_INPUTS, type ChannelMcpMutationMethod } from '../shared/channel-mcp-mutation-ipc-contract.js';
type RequestSource = 'user' | 'agent' | 'scheduler';
const own = Object.hasOwn;
function admission(method: ChannelMcpMutationMethod, args: unknown[], source?: RequestSource): unknown[] {
  if (source !== 'user') throw Error('channel_mcp_mutation_request_source_forbidden');
  const captured = captureIpcData(args, 'channel_mcp_mutation_input_invalid');
  const parsed = CHANNEL_MCP_MUTATION_INPUTS[method].safeParse(captured);
  if (!parsed.success) throw Error('channel_mcp_mutation_input_invalid');
  return parsed.data;
}
function readJson(path: string): unknown | undefined {
  let bytes: string;
  try { bytes = readFileSync(path, 'utf8'); }
  catch (error) {
    if (error && typeof error === 'object' && !types.isProxy(error) && Object.getOwnPropertyDescriptor(error, 'code')?.value === 'ENOENT') return undefined;
    throw Error('channel_mcp_mutation_source_unavailable');
  }
  // Native JSON.parse messages may echo credential fragments. Do not transport them.
  try { return captureIpcData(JSON.parse(bytes), 'channel_mcp_mutation_source_unavailable', { preserveDataPrototype: true }); }
  catch { throw Error('channel_mcp_mutation_source_unavailable'); }
}
function configForEdit(): Record<string, unknown> & { channels: Record<string, Record<string, unknown>> } {
  const loaded = readJson(getConfigPath());
  const raw = loaded === undefined ? JSON.parse(JSON.stringify(DEFAULT_CONFIG)) : loaded;
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error();
    const obj = raw as Record<string, unknown>;
    if (obj.schemaVersion !== 1 && obj.schemaVersion !== 2) throw Error();
    if (obj.schemaVersion === 1 && obj.defaultModel !== undefined && !isValidLegacyProvider(obj.defaultModel)) throw Error();
    if (obj.channels != null && !STORED_CHANNELS_READONLY_SCHEMA.safeParse(obj.channels).success) throw Error();
    const normalized = normalizeConfig(obj as unknown as LegacyConfig | Config);
    if (!STORED_CHANNELS_READONLY_SCHEMA.safeParse(normalized.channels ?? {}).success) throw Error();
    // Keep raw schema1/2 providers, keys, unknown extras and channel-specific state.
    // Normalize only to validate; a channel edit must not rewrite unrelated settings.
    obj.channels ??= {};
    return obj as Record<string, unknown> & { channels: Record<string, Record<string, unknown>> };
  } catch { throw Error('channel_mcp_mutation_source_unavailable'); }
}
async function persistConfig(config: Record<string, unknown>): Promise<void> {
  // saveConfig writes synchronously before returning its Promise. No await between read/edit/write.
  try { await saveConfig(config as unknown as Config); }
  catch { throw Error('channel_mcp_mutation_write_failed'); }
}
function channelView(id: string, row: Record<string, unknown>, createdAt = 0) {
  return { id, type: id, name: (row.name as string) || id, webhookUrl: (row.sendMsgUrl || row.webhookUrl) as string | undefined,
    enabled: row.enabled !== false, createdAt, updatedAt: Date.now() };
}
function readInstalls(root: string) {
  const raw = readJson(join(root, 'mcp-installs.json'));
  const rows = raw === undefined ? [] : raw;
  const parsed = MCP_INSTALLS_READONLY_OUTPUT_SCHEMA.safeParse(rows);
  if (!parsed.success) throw Error('channel_mcp_mutation_source_unavailable');
  if (new Set(parsed.data.map(row => row.id)).size !== parsed.data.length) throw Error('channel_mcp_mutation_source_unavailable');
  return parsed.data;
}
function writeInstalls(root: string, rows: unknown): void {
  const path = join(root, 'mcp-installs.json');
  try {
    mkdirSync(root, { recursive: true });
    if (process.platform !== 'win32' && existsSync(path)) {
      chmodSync(path, 0o600);
      if ((statSync(path).mode & 0o777) !== 0o600) throw Error();
    }
    writeFileSync(path, JSON.stringify(rows, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch { throw Error('channel_mcp_mutation_write_failed'); }
}
function mcpView(row: ReturnType<typeof readInstalls>[number]) {
  return { id: row.id, name: row.name, source: row.source, command: row.command, args: row.args, enabled: row.enabled, createdAt: row.createdAt };
}
export function createChannelMcpMutationOwner(dataRoot: string) {
  return {
    async createChannel(input: unknown, requestSource?: RequestSource) {
      const [parsed] = admission('createChannel', [input], requestSource);
      const value = parsed as { type: string; name: string; webhookUrl?: string } & Record<string, unknown>;
      const config = configForEdit(), prior = own(config.channels, value.type) ? config.channels[value.type] : {};
      const { type: id, webhookUrl, ...fields } = value;
      config.channels[id] = { ...prior, ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)), sendMsgUrl: webhookUrl || '', inboundMode: 'webhook', enabled: true };
      if (own(config.channels[id]!, 'webhookUrl')) config.channels[id]!.webhookUrl = webhookUrl || '';
      const result = { ...channelView(id, config.channels[id]!, Date.now()), name: value.name, webhookUrl };
      await persistConfig(config); return result;
    },
    async updateChannel(id: unknown, input: unknown, requestSource?: RequestSource) {
      const [key, patch] = admission('updateChannel', [id, input], requestSource) as [string, Record<string, unknown>];
      if (patch.type !== undefined && patch.type !== key) throw Error('channel_mcp_mutation_input_invalid');
      const config = configForEdit();
      if (!own(config.channels, key)) throw Error('Channel not found');
      const row = config.channels[key]!;
      for (const [field, value] of Object.entries(patch)) {
        if (value !== undefined && field !== 'type') row[field === 'webhookUrl' ? 'sendMsgUrl' : field] = value;
      }
      // A changed webhook must not be shadowed by an old webhookUrl in readonly projection.
      if (patch.webhookUrl !== undefined && own(row, 'webhookUrl')) row.webhookUrl = patch.webhookUrl;
      const result = channelView(key, row); await persistConfig(config); return result;
    },
    async deleteChannel(id: unknown, requestSource?: RequestSource) {
      const [key] = admission('deleteChannel', [id], requestSource) as [string];
      const config = configForEdit();
      if (!own(config.channels, key)) return; // preserve idempotent delete, do not create a default file
      delete config.channels[key]; await persistConfig(config);
    },
    async testChannel(id: unknown, requestSource?: RequestSource) {
      const [key] = admission('testChannel', [id], requestSource) as [string];
      const config = configForEdit(), row = own(config.channels, key) ? config.channels[key] : undefined;
      const url = row?.sendMsgUrl || row?.webhookUrl;
      if (!url) return { success: false, error: 'channel_mcp_mutation_webhook_missing' };
      let target: URL;
      try { target = new URL(url as string); }
      catch { return { success: false, error: 'channel_mcp_mutation_webhook_invalid' }; }
      if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) return { success: false, error: 'channel_mcp_mutation_webhook_invalid' };
      try {
        const start = Date.now();
        const response = await fetch(target.href, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ msgtype: 'text', text: { content: 'xiaok 测试连接 ✅' } }) });
        const latencyMs = Math.max(0, Date.now() - start);
        return response.ok ? { success: true, latencyMs } : { success: false, latencyMs, error: `HTTP ${response.status}` };
      } catch { return { success: false, error: 'channel_mcp_mutation_network_failed' }; }
      // No automatic resend, new timeout, install or process spawn. Original IPC shutdown token owns settlement.
    },
    async createMCPInstall(input: unknown, requestSource?: RequestSource) {
      const [parsed] = admission('createMCPInstall', [input], requestSource);
      const value = parsed as { name: string; source: 'npm' | 'github' | 'local'; command: string; args?: string[] };
      const rows = readInstalls(dataRoot), record = { ...value, id: randomUUID(), enabled: true, createdAt: Date.now() };
      rows.push(record); const result = mcpView(record); writeInstalls(dataRoot, rows); return result;
    },
    async updateMCPInstall(id: unknown, input: unknown, requestSource?: RequestSource) {
      const [key, patch] = admission('updateMCPInstall', [id, input], requestSource) as [string, Record<string, unknown>];
      const rows = readInstalls(dataRoot), row = rows.find(record => record.id === key);
      if (!row) throw Error('MCP install not found');
      for (const [field, value] of Object.entries(patch)) if (value !== undefined) row[field] = value;
      const result = mcpView(row); writeInstalls(dataRoot, rows); return result;
    },
    async deleteMCPInstall(id: unknown, requestSource?: RequestSource) {
      const [key] = admission('deleteMCPInstall', [id], requestSource) as [string];
      const rows = readInstalls(dataRoot); if (!rows.some(row => row.id === key)) return;
      writeInstalls(dataRoot, rows.filter(row => row.id !== key));
    },
  };
}
