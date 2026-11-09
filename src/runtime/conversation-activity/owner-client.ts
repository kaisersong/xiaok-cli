import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { activityOwnerAddress, readActivityOwnerCredentials, ACTIVITY_OWNER_PROTOCOL, ACTIVITY_REQUEST_BYTES, ACTIVITY_RESPONSE_BYTES, type ActivityClientRole } from './owner-protocol.js';
import type { ActivityChange } from './service.js';
import {readNativeSourceCredential} from './native-source-credentials.js';
import {assertBeforeEffects} from '../verification/before-effects.js';
import {z} from 'zod/v3';
import {captureProjectForwardData,parseProjectForwardStamp,projectForwardDigest,type ProjectForwardStamp} from './project-forward-snapshot-data.js';
import type {ConversationWorkView} from './types.js';
import type {AttentionDismiss} from './attention-work-reader.js';
import {projectUnavailableActivityAttention} from './attention-projector.js';

export type ActivityNativeConnection = Readonly<{ownerEpoch:string;connectionIncarnation:string}>;
type CapturedConnection = {socket:Socket;epoch:string;incarnation:string};
type ProjectControl={nonce:string;dirty:boolean;sequence?:number;connection?:CapturedConnection;floor:number;barrier?:Promise<void>};
const projectKey=z.string().min(1).max(256),projectSequence=z.number().int().nonnegative().safe();
const negativeSchema=z.object({type:z.literal('projectNegative'),protocol:z.literal(1),ownerEpoch:projectKey,projectId:projectKey,sequence:projectSequence}).strict();
const settledSchema=negativeSchema.extend({type:z.literal('projectSettled')});

/** Authenticated attachment. A lost mutation response is never replayed. */
export class ConversationActivityOwnerClient {
  readonly address;
  ownerEpoch?: string;
  private socket?: Socket;
  private connecting?: Promise<void>;
  private connectionIncarnation?:string;
  private nativeAuthorization?:CapturedConnection & {promise:Promise<ActivityNativeConnection>};
  private readonly nativeConnections=new WeakMap<ActivityNativeConnection,CapturedConnection>();
  private readonly projectControls=new Map<string,ProjectControl>();
  private readonly projectThreads=new Map<string,Map<string,string>>();
  private readonly projectViews=new WeakMap<object,{connection:CapturedConnection;projectId:string;sequence:number;nonce:string;stamp:ProjectForwardStamp|null}>();
  private projectProtocol?:CapturedConnection&{promise:Promise<void>};
  private readonly projectUnsupported=new WeakSet<object>();
  private buffer = '';
  private disposed = false;
  private readonly disconnectListeners = new Set<(ownerEpoch: string) => void>();
  onDisconnect(listener: (ownerEpoch: string) => void): () => void { this.disconnectListeners.add(listener); return () => { this.disconnectListeners.delete(listener); }; }
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: unknown): void; timer: ReturnType<typeof setTimeout>; socket: Socket;validate?(value:unknown):void }>();
  private readonly subscriptions = new Map<string, { threadId: string | null; handler: (change: ActivityChange) => void }>();
  constructor(dataRoot: string, private readonly role: ActivityClientRole, private readonly instanceId?: string) { this.address = activityOwnerAddress(dataRoot); }

  connect(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('activity_client_disposed'));
    if (this.socket && this.ownerEpoch) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const credentials = readActivityOwnerCredentials(this.address);
    const pending = new Promise<void>((resolve, reject) => {
      const socket = createConnection(this.address.socketPath); this.socket = socket; this.connectionIncarnation=randomUUID(); socket.setEncoding('utf8');
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

  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if(method==='sourceRestart'||method==='sourceEnsure')this.invalidateProjectReads();
    await this.connect();
    return this.requestOnSocket<T>(method,params,this.captureConnection());
  }
  private captureConnection():CapturedConnection {
    if(this.disposed||!this.socket||this.socket.destroyed||!this.ownerEpoch||!this.connectionIncarnation)throw Error('activity_owner_connection_lost');
    return {socket:this.socket,epoch:this.ownerEpoch,incarnation:this.connectionIncarnation};
  }
  private assertConnection(connection:CapturedConnection):void {
    if(this.disposed||connection.socket.destroyed||this.socket!==connection.socket||this.ownerEpoch!==connection.epoch||this.connectionIncarnation!==connection.incarnation)throw Error('activity_native_source_connection_stale');
  }
  private requestOnSocket<T>(method:string,params:Record<string,unknown>,connection:CapturedConnection,current?:()=>void,receive?:(value:unknown)=>T,validate?:(value:unknown)=>void):Promise<T> {
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
  private projectControl(projectId:string):ProjectControl{
    projectKey.parse(projectId);let state=this.projectControls.get(projectId);
    if(!state){if(this.projectControls.size>=512)throw Error('activity_project_read_capacity');state={nonce:randomUUID(),dirty:false,floor:0};this.projectControls.set(projectId,state);}return state;
  }
  private async requireProjectProtocol(connection:CapturedConnection):Promise<void>{
    const old=this.projectProtocol;
    if(old?.socket===connection.socket&&old.epoch===connection.epoch&&old.incarnation===connection.incarnation)return old.promise;
    const promise=this.requestOnSocket<unknown>('status',{},connection).then(raw=>{this.assertConnection(connection);const status=z.object({features:z.array(z.string()).optional()}).passthrough().parse(raw);if(!status.features?.includes('project_work_read_v1')){const error=Error('activity_project_forward_unsupported');this.projectUnsupported.add(error);throw error;}});
    this.projectProtocol={...connection,promise};return promise;
  }
  /** Known local invalidation is synchronous. It never creates Source proof. */
  invalidateProjectReads(projectId?:string):void{
    const states=projectId===undefined?this.projectControls.values():[this.projectControl(projectId)];
    for(const state of states){state.nonce=randomUUID();state.dirty=true;state.barrier=undefined;}
  }
  isProjectForwardUnsupported(error:unknown):boolean{return Boolean(error&&typeof error==='object'&&this.projectUnsupported.has(error));}
  projectConnectionChanged(status:'connected'|'disconnected'|'reconnecting'):Promise<void>{
    const projects=[...this.projectControls.keys()];this.invalidateProjectReads();
    return status==='connected'?Promise.all(projects.map(id=>this.hintProject(id))).then(()=>undefined):Promise.resolve();
  }
  hintProject(projectId:string):Promise<void>{
    const state=this.projectControl(projectId),nonce=randomUUID();state.nonce=nonce;state.dirty=true;
    const barrier=(async()=>{
      await this.connect();const connection=this.captureConnection();await this.requireProjectProtocol(connection);this.assertConnection(connection);
      if(state.nonce!==nonce)throw Error('activity_project_hint_superseded');
      const schema=z.object({protocol:z.literal(1),ownerEpoch:z.literal(connection.epoch),projectId:z.literal(projectId),nonce:z.literal(nonce),sequence:projectSequence}).strict();
      let ack:z.infer<typeof schema>|undefined;
      await this.requestOnSocket('projectHint',{projectId,nonce},connection,undefined,raw=>{
        const response=ack??schema.parse(raw);
        this.assertConnection(connection);
        if(state.nonce!==nonce||state.connection?.socket!==connection.socket||state.sequence===undefined||response.sequence>state.sequence)throw Error('activity_project_hint_unconfirmed');
        state.floor=response.sequence;state.dirty=false;
      },raw=>{ack=schema.parse(captureProjectForwardData(raw));});
    })();
    state.barrier=barrier;void barrier.catch(()=>{if(state.barrier===barrier)state.barrier=undefined;});return barrier;
  }
  /** Only this dedicated actual pending response path can mint a project view
   * receipt. Generic request JSON never enters this receive callback. */
  private decodeProjectResponse(raw:unknown,connection:CapturedConnection,watchId:string,projectId:string){
    const envelope=z.object({protocol:z.literal(1),ownerEpoch:z.literal(connection.epoch),projectId:z.literal(projectId),sequence:projectSequence,view:z.unknown(),stamp:z.unknown()}).strict().parse(captureProjectForwardData(raw));
    const view=envelope.view as ConversationWorkView;
    if(!view||view.watch?.watchId!==watchId||view.watch.source!=='kswarm'||view.watch.workId!==projectId)throw Error('activity_project_forward_data_invalid');
    const stamp=envelope.stamp===null?null:parseProjectForwardStamp(envelope.stamp);
    if(stamp){if(stamp.watchId!==watchId||stamp.viewDigest!==projectForwardDigest(view))throw Error('activity_project_forward_data_invalid');}
    else if(view.attentionState||view.presentation?.deliveryStage!=='none'||view.presentation?.protocolUnavailable!==true
      ||projectForwardDigest(view.presentation)!==projectForwardDigest({...projectUnavailableActivityAttention(view.watch,view.projection.revision),protocolUnavailable:true}))throw Error('activity_project_forward_data_invalid');
    return{envelope,view,stamp};
  }
  async readProjectWork(watchId:string,projectId:string,current?:()=>void,dismiss?:AttentionDismiss):Promise<ConversationWorkView>{
    projectKey.parse(watchId);const state=this.projectControl(projectId);assertBeforeEffects(current);
    await this.connect();const connection=this.captureConnection();await this.requireProjectProtocol(connection);assertBeforeEffects(current);this.assertConnection(connection);
    if(state.dirty&&!state.barrier)await this.hintProject(projectId);
    const nonce=state.nonce;if(state.barrier)await state.barrier;
    assertBeforeEffects(current);this.assertConnection(connection);if(state.dirty||state.nonce!==nonce)throw Error('activity_project_hint_unconfirmed');
    let decoded:ReturnType<ConversationActivityOwnerClient['decodeProjectResponse']>|undefined;
    const view=await this.requestOnSocket<ConversationWorkView>(dismiss?'projectDismissRead':'projectWorkRead',{watchId,projectId,...(dismiss?{dismiss}:{})},connection,current,raw=>{
      const {envelope,view:value,stamp}=decoded??this.decodeProjectResponse(raw,connection,watchId,projectId);
      this.assertConnection(connection);assertBeforeEffects(current);
      if(state.dirty||state.nonce!==nonce||state.connection?.socket!==connection.socket||state.sequence!==envelope.sequence||envelope.sequence<state.floor)throw Error('activity_project_read_superseded');
      let threads=this.projectThreads.get(projectId);if(!threads){threads=new Map();this.projectThreads.set(projectId,threads);}
      if(threads.size>=512&&!threads.has(watchId))throw Error('activity_project_read_capacity');
      threads.set(watchId,value.watch.origin.threadId);
      this.projectViews.set(value,{connection,projectId,sequence:envelope.sequence,nonce,stamp});return value;
    },raw=>{decoded=this.decodeProjectResponse(raw,connection,watchId,projectId);});
    assertBeforeEffects(current);this.assertProjectWorkReadCurrent(view);return view;
  }
  assertProjectWorkReadCurrent(raw:unknown):ProjectForwardStamp|null{
    const record=raw&&typeof raw==='object'?this.projectViews.get(raw):undefined;if(!record)throw Error('activity_project_return_unverified');
    this.assertConnection(record.connection);const state=this.projectControls.get(record.projectId);
    if(!state||state.dirty||state.nonce!==record.nonce||state.connection?.socket!==record.connection.socket||state.sequence!==record.sequence)throw Error('activity_project_read_superseded');return record.stamp;
  }
  /** Fixed to this actual socket. A reconnect never replays a Native request. */
  async requestNative<T>(method:string,params:Record<string,unknown>={},current?:()=>void):Promise<{value:T;connection:ActivityNativeConnection}> {
    assertBeforeEffects(current);
    const connection=await this.authorizeNativeSource();
    assertBeforeEffects(current);
    this.assertNativeConnectionCurrent(connection);
    const captured=this.nativeConnections.get(connection)!;
    const value=await this.requestOnSocket<T>(method,params,captured,current);
    assertBeforeEffects(current);
    this.assertNativeConnectionCurrent(connection);return {value,connection};
  }
  async authorizeNativeSource():Promise<ActivityNativeConnection> {
    if(this.role!=='producer')throw Error('activity_native_source_forbidden');
    await this.connect();const captured=this.captureConnection();
    const old=this.nativeAuthorization;
    if(old&&old.socket===captured.socket&&old.epoch===captured.epoch&&old.incarnation===captured.incarnation)return old.promise;
    const promise=Promise.resolve().then(async()=>{
      this.assertConnection(captured);
      const status=await this.requestOnSocket<{nativeSourceProtocol?:unknown}>('status',{},captured);this.assertConnection(captured);
      if(status.nativeSourceProtocol!==1)throw Error('activity_native_source_unsupported');
      const credential=readNativeSourceCredential(this.address);this.assertConnection(captured);
      const result=await this.requestOnSocket<{nativeSourceProtocol?:unknown;ownerEpoch?:unknown}>('authorizeNativeSource',{nativeSourceProtocol:1,ownerEpoch:captured.epoch,token:credential.token},captured);
      this.assertConnection(captured);
      if(result.nativeSourceProtocol!==1||result.ownerEpoch!==captured.epoch)throw Error('activity_native_source_forbidden');
      const frame=Object.freeze({ownerEpoch:captured.epoch,connectionIncarnation:captured.incarnation});this.nativeConnections.set(frame,captured);return frame;
    });
    const authorization={...captured,promise};this.nativeAuthorization=authorization;
    void promise.catch(()=>{if(this.nativeAuthorization===authorization)this.nativeAuthorization=undefined;});return promise;
  }
  assertNativeConnectionCurrent(frame:ActivityNativeConnection):void {
    const captured=this.nativeConnections.get(frame);if(!captured)throw Error('activity_native_source_connection_stale');this.assertConnection(captured);
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
  dispose(): void { if (this.disposed) return; this.disposed = true; this.nativeAuthorization=undefined;this.disconnectListeners.clear(); this.subscriptions.clear(); this.socket?.destroy(); }
}
