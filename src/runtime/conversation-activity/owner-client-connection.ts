import { assertBeforeEffects } from '../verification/before-effects.js';
import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { readActivityOwnerCredentials, ACTIVITY_OWNER_PROTOCOL, ACTIVITY_RESPONSE_BYTES, ACTIVITY_REQUEST_BYTES, type ActivityOwnerAddress, type ActivityClientRole } from './owner-protocol.js';
import type { ActivityChange } from './service.js';

// Private transport SPI: actual receiver and the original module-private DATA
// parsers are supplied only by OwnerClient.connect. No namespace/authority grant.
type CapturedConnection = { socket: Socket; epoch: string; incarnation: string };
type ProjectControl = { nonce: string; dirty: boolean; sequence?: number; connection?: CapturedConnection; floor: number; barrier?: Promise<void> };
type ProjectNegative = { type: 'projectNegative'; protocol: 1; ownerEpoch: string; projectId: string; sequence: number };
type ProjectSettled = Omit<ProjectNegative, 'type'> & { type: 'projectSettled' };
interface DataParser<T> { parse(raw: unknown): T }
interface OwnerClientConnectionState {
  readonly address: ActivityOwnerAddress;
  readonly role: ActivityClientRole;
  readonly instanceId?: string;
  disposed: boolean;
  socket?: Socket;
  connecting?: Promise<void>;
  ownerEpoch?: string;
  connectionIncarnation?: string;
  nativeAuthorization?: CapturedConnection & { promise: Promise<Readonly<{ ownerEpoch: string; connectionIncarnation: string }>> };
  projectProtocol?: CapturedConnection & { promise: Promise<void> };
  buffer: string;
  readonly projectControls: Map<string, ProjectControl>;
  readonly projectThreads: Map<string, Map<string, string>>;
  request<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  readonly pending: Map<string, { resolve(value: unknown): void; reject(error: unknown): void; timer: ReturnType<typeof setTimeout>; socket: Socket; validate?(value: unknown): void }>;
  readonly subscriptions: Map<string, { threadId: string | null; handler: (change: ActivityChange) => void }>;
  readonly disconnectListeners: Set<(ownerEpoch: string) => void>;
  trackSocket(socket: Socket): void;
  projectControl(projectId: string): ProjectControl;
  captureConnection(): CapturedConnection;
  assertConnection(connection: CapturedConnection): void;
}

/** Exact original handshake body, same receiver/fields/SDK order. */
export function connectOriginalActivityOwner(
  this: OwnerClientConnectionState,
  negativeSchema: DataParser<ProjectNegative>,
  settledSchema: DataParser<ProjectSettled>,
): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('activity_client_disposed'));
    if (this.socket && this.ownerEpoch) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const credentials = readActivityOwnerCredentials(this.address);
    const pending = new Promise<void>((resolve, reject) => {
      const socket = createConnection(this.address.socketPath); this.trackSocket(socket); this.socket = socket; this.connectionIncarnation=randomUUID(); socket.setEncoding('utf8');
      let admitted = false;
      let epoch: string | undefined;
      let notified = false;
      const timeout = setTimeout(() => { socket.destroy(); reject(new Error('activity_owner_handshake_timeout')); }, 5000);
      socket.once('connect', () => socket.write(JSON.stringify({ type: 'hello', protocol: ACTIVITY_OWNER_PROTOCOL, rootHash: this.address.rootHash, role: this.role, token: credentials[this.role], ...(this.instanceId ? { instanceId: this.instanceId } : {}) }) + '\n'));
      socket.on('data', (chunk: string) => {
        if (this.socket !== socket) return;
        this.buffer += chunk;
        if (Buffer.byteLength(this.buffer) > ACTIVITY_RESPONSE_BYTES) { socket.destroy(); return; }
        const batch:Record<string,unknown>[]=[];
        for (;;) {
          const end = this.buffer.indexOf('\n'); if (end < 0) break;
          const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
          let message: Record<string, unknown>;
          try {
            message=JSON.parse(line);
            if(!message||typeof message!=='object'||Array.isArray(message))throw Error('activity_owner_protocol_invalid');
            if(message.type==='projectNegative')negativeSchema.parse(message);
            else if(message.type==='projectSettled')settledSchema.parse(message);
            else if(message.type==='change'){
              if(typeof message.subscriptionId!=='string'||!message.change||typeof message.change!=='object'||typeof (message.change as ActivityChange).threadId!=='string')throw Error('activity_owner_protocol_invalid');
            }else if(message.type==='result'||message.type==='error'){
              if(typeof message.id!=='string'||message.type==='error'&&typeof message.code!=='string')throw Error('activity_owner_protocol_invalid');
              const request=this.pending.get(message.id);if(message.type==='result'&&request?.socket===socket)request.validate?.(message.result);
            }else if(message.type!=='hello')throw Error('activity_owner_protocol_invalid');
          }catch(error){closed(error);socket.destroy();return;}
          batch.push(message);
        }
        // Validate and apply every already complete negative before any RPC
        // resolution or reentrant subscription callback from this batch.
        if(!admitted&&batch.length){
          const message=batch.shift()!;
          if(message.type!=='hello'||message.protocol!==ACTIVITY_OWNER_PROTOCOL||message.rootHash!==this.address.rootHash||typeof message.ownerEpoch!=='string'){closed(Error('activity_owner_protocol_invalid'));socket.destroy();return;}
          admitted=true;clearTimeout(timeout);this.ownerEpoch=message.ownerEpoch;epoch=message.ownerEpoch;
          resolve();
          queueMicrotask(()=>{for(const[subscriptionId,subscription]of this.subscriptions){if(this.disposed||this.socket!==socket)break;void this.request(subscription.threadId===null?'overview':'subscribe',{subscriptionId,...(subscription.threadId===null?{}:{threadId:subscription.threadId})}).catch(()=>{});}});
        }
        try{
          for(const message of batch){
            if(message.type==='hello')throw Error('activity_owner_protocol_invalid');
            if(message.type==='projectSettled'&&message.ownerEpoch!==this.ownerEpoch)throw Error('activity_project_read_epoch_changed');
            if(message.type==='projectNegative'){
              const control=negativeSchema.parse(message);if(control.ownerEpoch!==this.ownerEpoch)throw Error('activity_project_read_epoch_changed');
              const state=this.projectControl(control.projectId),connection=this.captureConnection();
              const previous=state.connection?.socket===socket?state.sequence:undefined;
              if(previous!==undefined&&control.sequence<previous)throw Error('activity_project_read_sequence_reversed');
              state.connection=connection;state.sequence=control.sequence;
            }
          }
        }catch(error){closed(error);socket.destroy();return;}
        for(const message of batch){
          if(message.type==='projectNegative')continue;
          if(message.type==='projectSettled'){
            const settled=settledSchema.parse(message),state=this.projectControls.get(settled.projectId);
            if(state?.connection?.socket!==socket||state.sequence!==settled.sequence)continue;
            const subscriptions=[...this.subscriptions];
            for(const threadId of new Set(this.projectThreads.get(settled.projectId)?.values()??[]))for(const[id,subscription]of subscriptions){
              if(this.subscriptions.get(id)!==subscription)continue;
              if(subscription.threadId===null||subscription.threadId===threadId)subscription.handler({threadId});
            }
            continue;
          }
          if (message.type === 'change' && typeof message.subscriptionId === 'string') {
            const change = message.change as ActivityChange;
            if (change && typeof change.threadId === 'string') this.subscriptions.get(message.subscriptionId)?.handler(change);
            continue;
          }
          if (typeof message.id !== 'string') { socket.destroy(); return; }
          const request = this.pending.get(message.id); if (!request||request.socket!==socket) continue;
          this.pending.delete(message.id); clearTimeout(request.timer);
          if (message.type === 'result') request.resolve(message.result); else request.reject(new Error(typeof message.code === 'string' ? message.code : 'activity_owner_rpc_failed'));
        }
      });
      const closed = (error?: unknown) => {
        clearTimeout(timeout);
        if (this.socket === socket) { this.socket = undefined; this.ownerEpoch = undefined; this.connectionIncarnation=undefined;this.nativeAuthorization=undefined;this.projectProtocol=undefined;this.buffer = '';for(const state of this.projectControls.values()){state.dirty=true;state.sequence=undefined;state.connection=undefined;state.barrier=undefined;} }
        for (const [id, request] of this.pending) { if (request.socket !== socket) continue; clearTimeout(request.timer); request.reject(error ?? new Error('activity_owner_connection_lost')); this.pending.delete(id); }
        if (!admitted) reject(error ?? new Error('activity_owner_connection_lost'));
      };
      socket.on('error', error => { closed(error); socket.destroy(); }); socket.on('close', () => { closed(); if (admitted && epoch && !notified && !this.disposed) { notified = true; for (const listener of this.disconnectListeners) { try { listener(epoch); } catch {} } } });
    }).finally(() => { if (this.connecting === pending) this.connecting = undefined; });
    this.connecting = pending; return pending;
  }

/** Exact original bounded request send, same receiver and original guards. */
export function requestOriginalActivityOwner<T>(
  this: OwnerClientConnectionState,
  method: string, params: Record<string, unknown>, connection: CapturedConnection,
  current?: () => void, receive?: (value: unknown) => T, validate?: (value: unknown) => void,
): Promise<T> {
    this.assertConnection(connection);
    if (this.pending.size >= 64) throw new Error('activity_client_request_capacity');
    const id = randomUUID(), encoded = JSON.stringify({ type: 'request', id, method, params }) + '\n';
    if (Buffer.byteLength(encoded) > ACTIVITY_REQUEST_BYTES) throw new Error('activity_request_too_large');
    const socket = connection.socket;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('activity_owner_rpc_timeout')); }, 30_000);
      this.pending.set(id, { socket, resolve: value => {try{resolve(receive?receive(value):value as T);}catch(error){reject(error);}}, reject, timer,...(validate?{validate}:{}) });
      try {assertBeforeEffects(current);this.assertConnection(connection);socket.write(encoded, error => { if (!error) return; const request = this.pending.get(id); if (request) { this.pending.delete(id); clearTimeout(timer); request.reject(error); } });}
      catch(error){this.pending.delete(id);clearTimeout(timer);reject(error);}
    });
  }
