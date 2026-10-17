import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { activityOwnerAddress, readActivityOwnerCredentials, ACTIVITY_OWNER_PROTOCOL, ACTIVITY_REQUEST_BYTES, ACTIVITY_RESPONSE_BYTES, type ActivityClientRole } from './owner-protocol.js';
import type { ActivityChange } from './service.js';

/** Authenticated attachment. A lost mutation response is never replayed. */
export class ConversationActivityOwnerClient {
  readonly address;
  ownerEpoch?: string;
  private socket?: Socket;
  private connecting?: Promise<void>;
  private buffer = '';
  private disposed = false;
  private readonly disconnectListeners = new Set<(ownerEpoch: string) => void>();
  onDisconnect(listener: (ownerEpoch: string) => void): () => void { this.disconnectListeners.add(listener); return () => { this.disconnectListeners.delete(listener); }; }
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: unknown): void; timer: ReturnType<typeof setTimeout>; socket: Socket }>();
  private readonly subscriptions = new Map<string, { threadId: string | null; handler: (change: ActivityChange) => void }>();
  constructor(dataRoot: string, private readonly role: ActivityClientRole, private readonly instanceId?: string) { this.address = activityOwnerAddress(dataRoot); }

  connect(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('activity_client_disposed'));
    if (this.socket && this.ownerEpoch) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const credentials = readActivityOwnerCredentials(this.address);
    const pending = new Promise<void>((resolve, reject) => {
      const socket = createConnection(this.address.socketPath); this.socket = socket; socket.setEncoding('utf8');
      let admitted = false;
      let epoch: string | undefined;
      let notified = false;
      const timeout = setTimeout(() => { socket.destroy(); reject(new Error('activity_owner_handshake_timeout')); }, 5000);
      socket.once('connect', () => socket.write(JSON.stringify({ type: 'hello', protocol: ACTIVITY_OWNER_PROTOCOL, rootHash: this.address.rootHash, role: this.role, token: credentials[this.role], ...(this.instanceId ? { instanceId: this.instanceId } : {}) }) + '\n'));
      socket.on('data', (chunk: string) => {
        if (this.socket !== socket) return;
        this.buffer += chunk;
        if (Buffer.byteLength(this.buffer) > ACTIVITY_RESPONSE_BYTES) { socket.destroy(); return; }
        for (;;) {
          const end = this.buffer.indexOf('\n'); if (end < 0) break;
          const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
          let message: Record<string, unknown>;
          try { message = JSON.parse(line); } catch { socket.destroy(); return; }
          if (!admitted) {
            if (message.type !== 'hello' || message.protocol !== ACTIVITY_OWNER_PROTOCOL || message.rootHash !== this.address.rootHash || typeof message.ownerEpoch !== 'string') { socket.destroy(); return; }
            admitted = true; clearTimeout(timeout); this.ownerEpoch = message.ownerEpoch; epoch = message.ownerEpoch; resolve();
            // Replaying subscriptions is read-only. Mutations are never replayed.
            queueMicrotask(() => { for (const [subscriptionId, subscription] of this.subscriptions) {
              if (this.disposed || this.socket !== socket) break;
              void this.request(subscription.threadId === null ? 'overview' : 'subscribe', { subscriptionId, ...(subscription.threadId === null ? {} : { threadId: subscription.threadId }) }).catch(() => {});
            } }); continue;
          }
          if (message.type === 'change' && typeof message.subscriptionId === 'string') {
            const change = message.change as ActivityChange;
            if (change && typeof change.threadId === 'string') this.subscriptions.get(message.subscriptionId)?.handler(change);
            continue;
          }
          if (typeof message.id !== 'string') { socket.destroy(); return; }
          const request = this.pending.get(message.id); if (!request) continue;
          this.pending.delete(message.id); clearTimeout(request.timer);
          if (message.type === 'result') request.resolve(message.result); else request.reject(new Error(typeof message.code === 'string' ? message.code : 'activity_owner_rpc_failed'));
        }
      });
      const closed = (error?: unknown) => {
        clearTimeout(timeout);
        if (this.socket === socket) { this.socket = undefined; this.ownerEpoch = undefined; this.buffer = ''; }
        for (const [id, request] of this.pending) { if (request.socket !== socket) continue; clearTimeout(request.timer); request.reject(error ?? new Error('activity_owner_connection_lost')); this.pending.delete(id); }
        if (!admitted) reject(error ?? new Error('activity_owner_connection_lost'));
      };
      socket.on('error', error => { closed(error); socket.destroy(); }); socket.on('close', () => { closed(); if (admitted && epoch && !notified && !this.disposed) { notified = true; for (const listener of this.disconnectListeners) { try { listener(epoch); } catch {} } } });
    }).finally(() => { if (this.connecting === pending) this.connecting = undefined; });
    this.connecting = pending; return pending;
  }

  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    await this.connect();
    if (this.pending.size >= 64) throw new Error('activity_client_request_capacity');
    const id = randomUUID(), encoded = JSON.stringify({ type: 'request', id, method, params }) + '\n';
    if (Buffer.byteLength(encoded) > ACTIVITY_REQUEST_BYTES) throw new Error('activity_request_too_large');
    const socket = this.socket!;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('activity_owner_rpc_timeout')); }, 30_000);
      this.pending.set(id, { socket, resolve: value => resolve(value as T), reject, timer });
      socket.write(encoded, error => { if (!error) return; const request = this.pending.get(id); if (request) { this.pending.delete(id); clearTimeout(timer); request.reject(error); } });
    });
  }

  async subscribe(threadId: string, handler: (change: ActivityChange) => void): Promise<() => void> {
    const subscriptionId = randomUUID(); this.subscriptions.set(subscriptionId, { threadId, handler });
    try { await this.request('subscribe', { threadId, subscriptionId }); }
    catch (error) { this.subscriptions.delete(subscriptionId); throw error; }
    return () => { this.subscriptions.delete(subscriptionId); if (!this.disposed) void this.request('unsubscribe', { subscriptionId }).catch(() => {}); };
  }
  async subscribeOverview(handler: (change: ActivityChange) => void): Promise<() => void> {
    const subscriptionId = randomUUID(); this.subscriptions.set(subscriptionId, { threadId: null, handler });
    try { await this.request('overview', { subscriptionId }); }
    catch (error) { this.subscriptions.delete(subscriptionId); throw error; }
    return () => { this.subscriptions.delete(subscriptionId); if (!this.disposed) void this.request('unsubscribe', { subscriptionId }).catch(() => {}); };
  }
  close(): void { this.dispose(); }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.disconnectListeners.clear(); this.subscriptions.clear(); this.socket?.destroy(); }
}
