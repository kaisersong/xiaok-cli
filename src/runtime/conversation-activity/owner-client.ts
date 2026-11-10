import { connectOriginalActivityOwner, requestOriginalActivityOwner } from './owner-client-connection.js';
import type { Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { activityOwnerAddress, type ActivityClientRole } from './owner-protocol.js';
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
const applyActivityOwnerConnect = Reflect.apply;

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
  #sealed = false;
  #closing?: Promise<void>;
  #admissionCut?: readonly Promise<void>[];
  readonly #admissions = new Set<Promise<void>>();
  readonly #sockets = new Map<Socket, { promise: Promise<void>; observing: boolean }>();

  /** Reserve before SDK entry. */
  #admit<T>(begin: () => Promise<T>): Promise<T> {
    if (this.#sealed) return Promise.reject(new Error('activity_client_disposed'));
    let completed!: () => void, failed!: (error: unknown) => void;
    const reservation = new Promise<void>((resolve, reject) => { completed = resolve; failed = reject; });
    this.#admissions.add(reservation);
    void reservation.then(() => this.#admissions.delete(reservation), () => this.#admissions.delete(reservation));
    try {
      const raw = begin();
      void raw.then(() => completed(), failed);
      return raw;
    } catch (error) {
      failed(error);
      return Promise.reject(error);
    }
  }

  /** Negative admission cut. */
  seal(): void {
    if (this.#sealed) return;
    this.#sealed = true;
    this.#admissionCut = [...this.#admissions];
    this.disconnectListeners.clear();
    this.subscriptions.clear();
  }

  private trackSocket(socket: Socket): void {
    let closed!: () => void;
    const row = { promise: new Promise<void>(resolve => { closed = resolve; }), observing: false };
    this.#sockets.set(socket, row);
    socket.once('close', () => { this.#sockets.delete(socket); closed(); });
    row.observing = true;
  }

  private readonly disconnectListeners = new Set<(ownerEpoch: string) => void>();
  onDisconnect(listener: (ownerEpoch: string) => void): () => void { if (this.#sealed) throw new Error('activity_client_disposed'); this.disconnectListeners.add(listener); return () => { this.disconnectListeners.delete(listener); }; }
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: unknown): void; timer: ReturnType<typeof setTimeout>; socket: Socket;validate?(value:unknown):void }>();
  private readonly subscriptions = new Map<string, { threadId: string | null; handler: (change: ActivityChange) => void }>();
  constructor(dataRoot: string, private readonly role: ActivityClientRole, private readonly instanceId?: string) { this.address = activityOwnerAddress(dataRoot); }

  connect(): Promise<void> {
    return this.#admit(() => this.#connectEntered());
  }
  #connectEntered(): Promise<void> {
    return applyActivityOwnerConnect(connectOriginalActivityOwner, this, [negativeSchema, settledSchema]);
  }

  request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.#admit(() => this.#requestEntered<T>(method, params));
  }
  async #requestEntered<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if(method==='sourceRestart'||method==='sourceEnsure')this.invalidateProjectReads();
    await this.#connectEntered();
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
    return applyActivityOwnerConnect(requestOriginalActivityOwner, this, [method, params, connection, current, receive, validate]);
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
  projectConnectionChanged(status:'connected'|'disconnected'|'reconnecting'):Promise<void> {
    return this.#admit(() => this.#projectConnectionChangedEntered(status));
  }
  #projectConnectionChangedEntered(status:'connected'|'disconnected'|'reconnecting'):Promise<void>{
    const projects=[...this.projectControls.keys()];this.invalidateProjectReads();
    return status==='connected'?Promise.all(projects.map(id=>this.#hintProjectEntered(id))).then(()=>undefined):Promise.resolve();
  }
  hintProject(projectId:string):Promise<void> {
    return this.#admit(() => this.#hintProjectEntered(projectId));
  }
  #hintProjectEntered(projectId:string):Promise<void>{
    const state=this.projectControl(projectId),nonce=randomUUID();state.nonce=nonce;state.dirty=true;
    const barrier=(async()=>{
      await this.#connectEntered();const connection=this.captureConnection();await this.requireProjectProtocol(connection);this.assertConnection(connection);
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
  readProjectWork(watchId:string,projectId:string,current?:()=>void,dismiss?:AttentionDismiss):Promise<ConversationWorkView> {
    return this.#admit(() => this.#readProjectWorkEntered(watchId, projectId, current, dismiss));
  }
  async #readProjectWorkEntered(watchId:string,projectId:string,current?:()=>void,dismiss?:AttentionDismiss):Promise<ConversationWorkView>{
    projectKey.parse(watchId);const state=this.projectControl(projectId);assertBeforeEffects(current);
    await this.#connectEntered();const connection=this.captureConnection();await this.requireProjectProtocol(connection);assertBeforeEffects(current);this.assertConnection(connection);
    if(state.dirty&&!state.barrier)await this.#hintProjectEntered(projectId);
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
    assertBeforeEffects(current);this.#assertProjectWorkReadCurrentEntered(view);return view;
  }
  assertProjectWorkReadCurrent(raw:unknown):ProjectForwardStamp|null {
    if (this.#sealed) throw new Error('activity_client_disposed');
    return this.#assertProjectWorkReadCurrentEntered(raw);
  }
  #assertProjectWorkReadCurrentEntered(raw:unknown):ProjectForwardStamp|null{
    const record=raw&&typeof raw==='object'?this.projectViews.get(raw):undefined;if(!record)throw Error('activity_project_return_unverified');
    this.assertConnection(record.connection);const state=this.projectControls.get(record.projectId);
    if(!state||state.dirty||state.nonce!==record.nonce||state.connection?.socket!==record.connection.socket||state.sequence!==record.sequence)throw Error('activity_project_read_superseded');return record.stamp;
  }
  /** Fixed to this actual socket. A reconnect never replays a Native request. */
  requestNative<T>(method:string,params:Record<string,unknown>={},current?:()=>void):Promise<{value:T;connection:ActivityNativeConnection}> {
    return this.#admit(() => this.#requestNativeEntered<T>(method, params, current));
  }
  async #requestNativeEntered<T>(method:string,params:Record<string,unknown>={},current?:()=>void):Promise<{value:T;connection:ActivityNativeConnection}> {
    assertBeforeEffects(current);
    const connection=await this.authorizeNativeSource();
    assertBeforeEffects(current);
    this.#assertNativeConnectionCurrentEntered(connection);
    const captured=this.nativeConnections.get(connection)!;
    const value=await this.requestOnSocket<T>(method,params,captured,current);
    assertBeforeEffects(current);
    this.#assertNativeConnectionCurrentEntered(connection);return {value,connection};
  }
  authorizeNativeSource():Promise<ActivityNativeConnection> {
    return this.#admit(() => this.#authorizeNativeSourceEntered());
  }
  async #authorizeNativeSourceEntered():Promise<ActivityNativeConnection> {
    if(this.role!=='producer')throw Error('activity_native_source_forbidden');
    await this.#connectEntered();const captured=this.captureConnection();
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
    if (this.#sealed) throw new Error('activity_client_disposed');
    this.#assertNativeConnectionCurrentEntered(frame);
  }
  #assertNativeConnectionCurrentEntered(frame:ActivityNativeConnection):void {
    const captured=this.nativeConnections.get(frame);if(!captured)throw Error('activity_native_source_connection_stale');this.assertConnection(captured);
  }

  subscribe(threadId: string, handler: (change: ActivityChange) => void): Promise<() => void> {
    return this.#admit(() => this.#subscribeEntered(threadId, handler));
  }
  async #subscribeEntered(threadId: string, handler: (change: ActivityChange) => void): Promise<() => void> {
    const subscriptionId = randomUUID(); this.subscriptions.set(subscriptionId, { threadId, handler });
    try { await this.request('subscribe', { threadId, subscriptionId }); }
    catch (error) { this.subscriptions.delete(subscriptionId); throw error; }
    return () => { this.subscriptions.delete(subscriptionId); if (!this.disposed) void this.request('unsubscribe', { subscriptionId }).catch(() => {}); };
  }
  subscribeOverview(handler: (change: ActivityChange) => void): Promise<() => void> {
    return this.#admit(() => this.#subscribeOverviewEntered(handler));
  }
  async #subscribeOverviewEntered(handler: (change: ActivityChange) => void): Promise<() => void> {
    const subscriptionId = randomUUID(); this.subscriptions.set(subscriptionId, { threadId: null, handler });
    try { await this.request('overview', { subscriptionId }); }
    catch (error) { this.subscriptions.delete(subscriptionId); throw error; }
    return () => { this.subscriptions.delete(subscriptionId); if (!this.disposed) void this.request('unsubscribe', { subscriptionId }).catch(() => {}); };
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    let completed!: () => void, failed!: (error: unknown) => void;
    this.#closing = new Promise<void>((resolve, reject) => { completed = resolve; failed = reject; });
    void this.#closing.catch(() => {});
    this.seal();
    void (async () => {
      const failures: unknown[] = [];
      const results = await Promise.allSettled(this.#admissionCut ?? []);
      for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
      this.disposed = true;
      this.nativeAuthorization = undefined;
      const closing: Promise<void>[] = [];
      for (const [socket, row] of this.#sockets) {
        try {
          socket.destroy();
          if (row.observing) closing.push(row.promise);
          else failures.push(new Error('activity_socket_close_unconfirmed'));
        } catch (error) {
          failures.push(error);
        }
      }
      const sockets = await Promise.allSettled(closing);
      for (const result of sockets) if (result.status === 'rejected') failures.push(result.reason);
      if (failures.length) throw new AggregateError(failures, 'activity_client_drain_failed');
    })().then(completed, failed);
    return this.#closing;
  }
  dispose(): void { this.seal(); void this.close(); }
}
