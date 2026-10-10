import { chmodPrivateActivityFile } from './storage-permissions.js';
import { ACTIVITY_STORAGE_NAMES } from './storage-permissions.js';
import { readFileSync, existsSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { createTaskSessionEndpointId } from '@modelcontextprotocol/ext-tasks/client';
import { createMcpClientConnection, type McpClientConnection } from '../../platform/mcp/transport.js';
import type { McpServerConfig } from '../../platform/mcp/types.js';
import { ConversationMcpActivities } from './mcp.js';
import type { ConversationActivityStore } from './store.js';
import type { ConversationActivityService } from './service.js';
import type { WorkWatch } from './types.js';
const text = z.string().min(1).max(4096);
const endpointSchema = z.object({ endpointId: text, name: text, config: z.union([
  z.object({ type: z.enum(['http','sse']), url: z.string().url().max(4096), headers: z.record(z.string(), z.string().max(8192)).optional(), timeout: z.object({ startup: z.number().positive().optional(), catalog: z.number().positive().optional(), call: z.number().positive().optional(), resource: z.number().positive().optional() }).strict().optional(), protocol: z.union([z.object({ mode: z.enum(['auto','legacy']) }).strict(),z.object({ mode: z.literal('modern'), version: z.literal('2026-07-28') }).strict()]).optional() }).strict(),
  z.object({ type: z.literal('ws'), url: z.string().url().max(4096), timeout: z.object({ startup: z.number().positive().optional(), catalog: z.number().positive().optional(), call: z.number().positive().optional(), resource: z.number().positive().optional() }).strict().optional(), protocol: z.union([z.object({ mode: z.enum(['auto','legacy']) }).strict(),z.object({ mode: z.literal('modern'), version: z.literal('2026-07-28') }).strict()]).optional() }).strict(),
]).optional(), cwd: z.string().max(4096).optional() }).strict();
type Endpoint = z.infer<typeof endpointSchema>;
/** Restore known remote task handles only. Stdio remains native-process owned:
 * loss of that process is reported, never repaired by invoking tools/call. */
export class ActivityOwnerMcp {
  readonly activities: ConversationMcpActivities;
  private readonly endpoints = new Map<string, Endpoint>();
  private readonly localClaims = new Map<string, Set<string>>();
  private readonly connections = new Map<string, McpClientConnection>();
  private readonly connecting = new Map<string, Promise<void>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private disposed = false;
  constructor(private readonly options: { root: string; store: ConversationActivityStore; service: ConversationActivityService; actorId: string }) {
    this.activities = new ConversationMcpActivities({ ...options, originThread: async () => null, onError: error => {
      const name = error instanceof Error ? error.name : 'UnknownError';
      process.stderr.write(`activity_mcp_observation_failed:${/^[A-Za-z]+$/.test(name) ? name : 'Error'}\n`);
    } });
    const path = join(options.root, ACTIVITY_STORAGE_NAMES.endpoints);
    if (existsSync(path)) {
      const state = statSync(path);
      if (state.size > 192 * 1024 || process.platform !== 'win32' && (state.uid !== process.getuid?.() || (state.mode & 0o077) !== 0)) throw new Error('activity_mcp_config_not_private');
      const values = z.array(endpointSchema).max(64).parse(JSON.parse(readFileSync(path, 'utf8')));
      for (const value of values) if (value.config) this.endpoints.set(value.endpointId, value);
    }
  }
  canObserve(watch: WorkWatch): boolean {
    const reference = this.options.store.getMcpReference(watch.watchId);
    return Boolean(reference && reference.endpointId === watch.logicalSourceId && reference.taskId === watch.workId
      && (this.endpoints.has(reference.endpointId) || this.localClaims.get(reference.endpointId)?.size));
  }
  async register(raw: unknown, clientId: string): Promise<void> {
    const endpoint = endpointSchema.parse(raw);
    if (!endpoint.config) {
      let claims = this.localClaims.get(endpoint.endpointId); if (!claims) this.localClaims.set(endpoint.endpointId, claims = new Set()); claims.add(clientId); return;
    }
    if (await createTaskSessionEndpointId('xiaok-mcp', { serverName: endpoint.name, config: endpoint.config }) !== endpoint.endpointId) throw new Error('activity_mcp_endpoint_mismatch');
    if (this.endpoints.size >= 64 && !this.endpoints.has(endpoint.endpointId)) throw new Error('activity_mcp_endpoint_capacity');
    this.endpoints.set(endpoint.endpointId, endpoint);
    const file = join(this.options.root, ACTIVITY_STORAGE_NAMES.endpoints), tmp = `${file}.${process.pid}.tmp`, encoded = JSON.stringify([...this.endpoints.values()]);
    if (Buffer.byteLength(encoded) > 192 * 1024) throw new Error('activity_mcp_config_capacity');
    writeFileSync(tmp, encoded, { mode: 0o600 }); chmodPrivateActivityFile(tmp); renameSync(tmp, file);
    await this.connect(endpoint);
  }
  async restore(): Promise<void> {
    for (const endpoint of this.endpoints.values()) if (this.options.store.listWatches().some(watch => watch.source === 'mcp' && watch.logicalSourceId === endpoint.endpointId && watch.status === 'active')) {
      await this.connect(endpoint).catch(() => this.retry(endpoint));
    }
  }
  private connect(endpoint: Endpoint): Promise<void> {
    if (this.disposed || this.connections.has(endpoint.endpointId)) return Promise.resolve();
    const old = this.connecting.get(endpoint.endpointId); if (old) return old;
    const pending = (async () => {
      if (!endpoint.config) return;
      const connection = await createMcpClientConnection(endpoint.name, endpoint.config as McpServerConfig, { cwd: endpoint.cwd, clientName: 'xiaok-activity-owner' });
      if (this.disposed) { await connection.close(); return; }
      if (connection.tasks?.endpointId !== endpoint.endpointId) { await connection.close(); throw new Error('activity_mcp_endpoint_mismatch'); }
      this.connections.set(endpoint.endpointId, connection); this.activities.register(connection);
      const close = connection.client.onclose;
      connection.client.onclose = () => { try { close?.(); } finally { if (this.connections.get(endpoint.endpointId) === connection) { this.connections.delete(endpoint.endpointId); this.retry(endpoint); } } };
    })().finally(() => this.connecting.delete(endpoint.endpointId));
    this.connecting.set(endpoint.endpointId, pending); return pending;
  }
  private retry(endpoint: Endpoint): void {
    if (this.disposed || this.timers.has(endpoint.endpointId)) return;
    const timer = setTimeout(() => { this.timers.delete(endpoint.endpointId); void this.connect(endpoint).catch(() => this.retry(endpoint)); }, 15_000); timer.unref(); this.timers.set(endpoint.endpointId, timer);
  }
  bound(watch: WorkWatch): void { const endpoint = this.endpoints.get(watch.logicalSourceId); if (endpoint) void this.connect(endpoint).then(() => { const connection = this.connections.get(endpoint.endpointId); if (connection) this.activities.register(connection); }).catch(() => this.retry(endpoint)); }
  async disconnected(clientId: string): Promise<void> {
    for (const [endpointId, claims] of this.localClaims) if (claims.delete(clientId) && !claims.size) {
      this.localClaims.delete(endpointId);
      for (const watch of this.options.store.listWatches()) if (watch.source === 'mcp' && watch.logicalSourceId === endpointId) await this.options.service.sourceUnavailable(watch.watchId, 'unavailable', 'activity_mcp_disconnected');
    }
  }
  async close(): Promise<void> { this.disposed = true; this.activities.dispose(); for (const timer of this.timers.values()) clearTimeout(timer); await Promise.allSettled([...this.connections.values()].map(connection => connection.close())); this.connections.clear(); }
}
