import {assertBeforeEffects} from '../verification/before-effects.js';
import { chmodPrivateActivityFile } from './storage-permissions.js';
import { ACTIVITY_STORAGE_NAMES } from './storage-permissions.js';
import { createServer, createConnection, type Server, type Socket } from 'node:net';
import { existsSync, lstatSync, unlinkSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { taskId } from '@modelcontextprotocol/ext-tasks/core';
import { ConversationActivityStore } from './store.js';
import { ConversationActivityService, type ActivityThreadIdentity } from './service.js';
import type { WorkWatch } from './types.js';
import {ActivityAttentionReaders} from './attention-reader-owner.js';
import type {ProjectForwardStamp} from './project-forward-snapshot-data.js';
import {createNativeSourceCredential,readNativeSourceCredential,type NativeSourceCredential} from './native-source-credentials.js';
import { activityOwnerAddress, createActivityOwnerCredentials, authenticateActivityClient, ACTIVITY_OWNER_PROTOCOL, ACTIVITY_OWNER_GENERATION,
  ACTIVITY_REQUEST_BYTES, ACTIVITY_RESPONSE_BYTES, type ActivityClientRole } from './owner-protocol.js';

/** Default grace period after the last client/request/watch change. */
export const ACTIVITY_OWNER_IDLE_MS = 20 * 60_000;
/** Bound observation without an authenticated client, including active watches. */
export const ACTIVITY_OWNER_MAX_UNATTENDED_MS = 24 * 60 * 60_000;
/** Polling bounds shutdown latency without keeping the process alive. */
const ACTIVITY_OWNER_IDLE_CHECK_MS = 1000;
export function activityOwnerTimeout(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return /^\d+$/.test(value ?? '') && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const key = z.string().min(1).max(256);
const USER_METHODS = new Set(['status','list','work','projectWorkRead','projectDismissRead','unread','read','reporting','stop','subscribe','overview','unsubscribe','mcpInputs','mcpAnswer','mcpCancel']);
interface Client { id: string; socket: Socket; buffer: string; role?: ActivityClientRole; instanceId?: string; active: boolean; pending: number; subscriptions: Map<string, () => void> }

/** Activity-only owner. It never creates a task, Goal, agent or LLM runner. */
export class ConversationActivityOwnerHost {
  readonly ownerEpoch = randomUUID();
  readonly address;
  readonly store: ConversationActivityStore;
  readonly service: ConversationActivityService;
  private readonly attentionReaders:ActivityAttentionReaders;
  private nativeSourceCredential?:NativeSourceCredential;
  private nativeSourceFailure?:unknown;
  private readonly nativeSourceClients=new WeakSet<Client>();
  private readonly projectSequences=new Map<string,number>();
  private readonly projectPeers=new Map<string,Set<Client>>();
  private readonly projectHintNonces=new Map<string,string>();
  private readonly projectEnvelopes=new WeakMap<object,{view:unknown;stamp:ProjectForwardStamp|null;projectId:string;sequence:number}>();
  private readonly projectHintPort?:NonNullable<NonNullable<ConstructorParameters<typeof ConversationActivityService>[0]['projectSource']>['admitHint']>;
  private server?: Server;
  private readonly clients = new Set<Client>();
  private pending = 0;
  private stopped = false;
  private closing = false;
  private sealed?: Promise<void>;
  private stopping?: Promise<void>;
  private readonly requestWork = new Set<Promise<void>>();
  private readonly disconnectWork = new Map<Socket, Promise<void>>();
  private readonly shutdownErrors: unknown[] = [];
  /** Seal admission now; own actual accepted request/socket callback completion. */
  sealAndDrain(): Promise<void> {
    if (this.sealed) return this.sealed;
    this.closing = true;
    this.attentionReaders.seal();
    const work = [...this.requestWork, ...this.disconnectWork.values()];
    for (const client of this.clients) client.socket.destroy();
    this.sealed = (async () => {
      const outcomes = await Promise.allSettled(work);
      const failures = [...this.shutdownErrors, ...outcomes.flatMap(result => result.status === 'rejected' ? [result.reason] : [])];
      if (failures.length) throw new AggregateError([...new Set(failures)], 'activity_host_drain_failed');
    })();
    return this.sealed;
  }
  private readonly actor;
  private readonly now: () => number;
  private lastActivity: number;
  private unattendedSince: number;
  private watchState = '';
  private idleEmitted = false;
  private idleTimer?: ReturnType<typeof setInterval>;
  private readonly idleMs: number;
  private readonly unattendedMs: number;

  checkIdle(): void {
    if (this.stopped || this.closing || this.idleEmitted || !this.options.idle || this.options.ready?.() === false) return;
    const now = this.now();
    const watches = this.store.listWatches().map(watch => ({ watch, projection: this.store.getProjection(watch.watchId) }));
    const state = JSON.stringify(watches);
    if (this.watchState && state !== this.watchState) this.lastActivity = now;
    this.watchState = state;
    if ([...this.clients].some(client => client.active && client.role)) { this.unattendedSince = now; this.lastActivity = now; return; }
    if (this.pending) return;
    const unfinished = watches.some(({ watch, projection }) => watch.status === 'active' && !['completed','failed','cancelled'].includes(projection?.executionState ?? ''));
    if ((!unfinished && now - this.lastActivity >= this.idleMs) || now - this.unattendedSince >= this.unattendedMs) {
      this.idleEmitted = true; this.options.idle();
    }
  }
  constructor(private readonly options: { dataRoot: string; profileId: string; actorId: string;
    now?(): number; idle?(): void; env?: NodeJS.ProcessEnv;
    setInterval?: typeof setInterval; clearInterval?: typeof clearInterval;
    configDigest?: string; ready?(): boolean; nativeSourceSupported?:boolean;
    mcpRequest?(method: string, params: Record<string, unknown>, clientId: string): Promise<unknown>;
    disconnected?(clientId: string): Promise<void>;
    sourceControl?(method: string, params: Record<string, unknown>): Promise<unknown>;
    getThread(threadId: string): ActivityThreadIdentity | null;
    canObserveWork(watch: WorkWatch): Promise<boolean> | boolean;
    assertTaskSourceOwner?:ConstructorParameters<typeof ConversationActivityService>[0]['assertTaskSourceOwner'];
    projectSource?:ConstructorParameters<typeof ConversationActivityService>[0]['projectSource'];
    authorizeProducer(threadId: string, instanceId?: string): boolean;
    notify?: ConstructorParameters<typeof ConversationActivityService>[0]['notify'];
    stopWatch?(watchId: string): void; watchBound?(watchId: string): Promise<void> | void;
    sourceHint?(source: string, workId: string): Promise<void> | void; onError?(error: unknown): void }) {
    this.now = options.now ?? Date.now;
    this.lastActivity = this.unattendedSince = this.now();
    this.idleMs = activityOwnerTimeout((options.env ?? process.env).XIAOK_ACTIVITY_OWNER_IDLE_MS, ACTIVITY_OWNER_IDLE_MS);
    this.unattendedMs = activityOwnerTimeout((options.env ?? process.env).XIAOK_ACTIVITY_OWNER_MAX_UNATTENDED_MS, ACTIVITY_OWNER_MAX_UNATTENDED_MS);
    this.address = activityOwnerAddress(options.dataRoot);
    this.store = new ConversationActivityStore(join(this.address.dataRoot, ACTIVITY_STORAGE_NAMES.database),options.projectSource?{projectOrdinarySource:frame=>this.service.resolveProjectOrdinarySource(frame),projectDeliverySource:frame=>this.service.resolveProjectDeliverySource(frame)}:{});
    this.actor = { requestSource: 'user' as const, actorId: options.actorId };
    this.projectHintPort=options.projectSource?.admitHint?.bind(options.projectSource);
    this.service = new ConversationActivityService({ ...options, store: this.store,projectReadInvalidated:projectId=>this.invalidateProjectReads(projectId) });
    this.attentionReaders=new ActivityAttentionReaders({store:this.store,service:this.service,actor:this.actor,ownerEpoch:this.ownerEpoch,getThread:options.getThread,
      assertProducer:(client,threadId)=>{if(!this.clients.has(client as Client)||client.role!=='producer'||!client.active||this.closing||this.stopped
        ||threadId!==undefined&&!options.authorizeProducer(threadId,client.instanceId))throw Error('activity_producer_forbidden');},
      assertNativeProducer:client=>this.assertNativeSourceClient(client as Client)});
  }

  async start(): Promise<void> {
    if (this.server) return;
    if (this.stopped) throw new Error('activity_owner_stopped');
    try {
      if (process.platform !== 'win32' && existsSync(this.address.socketPath)) {
        const live = await new Promise<boolean>((resolve, reject) => {
          const socket = createConnection(this.address.socketPath);
          const timer = setTimeout(() => { socket.destroy(); reject(new Error('activity_socket_probe_timeout')); }, 1000);
          socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
          socket.once('error', error => {
            clearTimeout(timer); socket.destroy();
            if (['ENOENT','ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '')) resolve(false); else reject(error);
          });
        });
        if (live) throw new Error('activity_owner_live_socket');
        if (!lstatSync(this.address.socketPath).isSocket()) throw new Error('activity_socket_not_socket');
        // Only after the store's OS lock was acquired and dead-socket proof.
        unlinkSync(this.address.socketPath);
      }
      const credentials = createActivityOwnerCredentials(this.address);
      if(this.options.nativeSourceSupported)try{this.nativeSourceCredential=createNativeSourceCredential(this.address);}
      catch(error){this.options.onError?.(error);}
      this.server = createServer(socket => {
        if (this.closing || this.clients.size >= 64) { socket.destroy(); return; }
        const client: Client = { id: randomUUID(), socket, buffer: '', active: true, pending: 0, subscriptions: new Map() }; this.clients.add(client);
        socket.setEncoding('utf8');
        const handshake = setTimeout(() => { if (!client.role) socket.destroy(); }, 2000); handshake.unref();
        socket.on('data', (chunk: string) => {
          client.buffer += chunk;
          if (Buffer.byteLength(client.buffer) > ACTIVITY_REQUEST_BYTES) { socket.destroy(); return; }
          for (;;) {
            const end = client.buffer.indexOf('\n'); if (end < 0) break;
            const line = client.buffer.slice(0, end); client.buffer = client.buffer.slice(end + 1);
            let message: unknown;
            try { message = JSON.parse(line); } catch { socket.destroy(); return; }
            if (!client.role) {
              try { client.role = authenticateActivityClient(credentials, message); client.instanceId = (message as { instanceId?: string }).instanceId; clearTimeout(handshake); this.lastActivity = this.unattendedSince = this.now();
                this.send(client, { type: 'hello', protocol: ACTIVITY_OWNER_PROTOCOL, rootHash: this.address.rootHash, ownerEpoch: this.ownerEpoch,profileId:this.options.profileId,configDigest:this.options.configDigest,generation:ACTIVITY_OWNER_GENERATION }); }
              catch { socket.destroy(); return; }
            } else void this.request(client, message);
          }
        });
        const disconnected = new Promise<void>((resolve, reject) => socket.once('close', () => {
          if (client.role) { this.lastActivity = this.now(); if (![...this.clients].some(other => other !== client && other.active && other.role)) this.unattendedSince = this.now(); }
          clearTimeout(handshake); client.active = false; this.nativeSourceClients.delete(client); this.clients.delete(client);
          for(const peers of this.projectPeers.values())peers.delete(client);
          const failures: unknown[] = [];
          try{this.attentionReaders.disconnected(client);}catch(error){failures.push(error);}
          for (const stop of client.subscriptions.values()) { try { stop(); } catch (error) { failures.push(error); } }
          client.subscriptions.clear();
          let callback: Promise<void> | undefined;
          try { callback = this.options.disconnected?.(client.id); } catch (error) { failures.push(error); }
          const finish = () => {
            if (failures.length) reject(new AggregateError(failures, 'activity_client_disconnect_failed')); else resolve();
          };
          void Promise.resolve(callback).then(finish, error => {
            failures.push(error); try { this.options.onError?.(error); } catch (observedError) { failures.push(observedError); } finish();
          });
        }));
        this.disconnectWork.set(socket, disconnected);
        void disconnected.then(() => { this.disconnectWork.delete(socket); }, error => {
          this.disconnectWork.delete(socket); this.shutdownErrors.push(error);
        });
        socket.on('error', () => socket.destroy());
      });
      await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(this.address.socketPath, () => { this.server!.off('error', reject); resolve(); }); });
      const statusFile = join(this.address.dataRoot, ACTIVITY_STORAGE_NAMES.status);
      writeFileSync(`${statusFile}.${process.pid}.tmp`, JSON.stringify({ ownerEpoch: this.ownerEpoch, pid: process.pid, rootHash: this.address.rootHash }), { mode: 0o600 });
      chmodPrivateActivityFile(`${statusFile}.${process.pid}.tmp`); renameSync(`${statusFile}.${process.pid}.tmp`, statusFile);
      this.service.start();
      this.watchState = JSON.stringify(this.store.listWatches().map(watch => ({ watch, projection: this.store.getProjection(watch.watchId) })));
      if (this.options.idle) { this.idleTimer = (this.options.setInterval ?? setInterval)(() => this.checkIdle(), ACTIVITY_OWNER_IDLE_CHECK_MS); this.idleTimer.unref(); }
    } catch (error) { await this.stop(); throw error; }
  }

  private send(client: Client, message: unknown,beforeWrite?:()=>void): void {
    if (!client.active) return;
    const encoded = JSON.stringify(message) + '\n';
    if (Buffer.byteLength(encoded) > ACTIVITY_RESPONSE_BYTES || client.socket.writableLength > ACTIVITY_RESPONSE_BYTES) { client.socket.destroy(); return; }
    if(beforeWrite){assertBeforeEffects(beforeWrite);if(!client.active||this.stopped||this.closing)throw Error('activity_owner_closing');}
    client.socket.write(encoded);
  }
  private request(client: Client, raw: unknown): Promise<void> {
    // Register ownership BEFORE invoking a body whose synchronous prefix may
    // reenter stop(). This reservation settles only from the real raw Promise.
    let completed!: () => void, failed!: (error: unknown) => void;
    const reservation = new Promise<void>((resolve, reject) => { completed = resolve; failed = reject; });
    this.requestWork.add(reservation);
    void reservation.then(() => { this.requestWork.delete(reservation); }, error => {
      this.requestWork.delete(reservation); this.shutdownErrors.push(error);
    });
    try {
      const rawWork = this.performRequest(client, raw);
      void rawWork.then(completed, failed);
      return rawWork;
    } catch (error) {
      failed(error);
      return reservation;
    }
  }
  private async performRequest(client: Client, raw: unknown): Promise<void> {
    if (!client.active || this.stopped) return;
    const parsed = z.object({ type: z.literal('request'), id: key, method: key, params: z.record(z.string(), z.unknown()) }).strict().safeParse(raw);
    if (!parsed.success || client.pending >= 64 || this.pending >= 256) { client.socket.destroy(); return; }
    const { id, method, params } = parsed.data;
    if (this.closing) { this.send(client, { type: 'error', id, code: 'activity_owner_closing' }); return; }
    client.pending++; this.pending++; this.lastActivity = this.now();
    try {
      if (client.role === 'user' && !USER_METHODS.has(method)) throw new Error('activity_method_forbidden');
      const result = await this.dispatch(client, method, params);
      if(client.active)this.send(client,{type:'result',id,result},method==='projectWorkRead'||method==='projectDismissRead'?()=>this.assertProjectEnvelopeCurrent(result):method==='work'&&this.options.projectSource?()=>{
        const watchId=z.object({watchId:key}).strict().parse(params).watchId;
        const original=result as {watch?:{source?:string}};
        if(original?.watch?.source==='kswarm'||this.store.getWatch(watchId)?.source==='kswarm')this.service.assertProjectWorkReadCurrent(result,this.actor);
      }:undefined);
    } catch (error) { this.send(client, { type: 'error', id, code: error instanceof Error ? error.message.slice(0, 256) : 'activity_request_failed' }); }
    finally { client.pending--; this.pending--; this.lastActivity = this.now(); }
  }
  /** Negative control only. Registered authorized peers receive no work data. */
  invalidateProjectReads(projectId?:string):void{
    for(const id of projectId===undefined?this.projectPeers.keys():[projectId]){
      const sequence=(this.projectSequences.get(id)??0)+1;
      if(!Number.isSafeInteger(sequence)){for(const peer of this.projectPeers.get(id)??[])peer.socket.destroy();throw Error('activity_project_read_sequence_exhausted');}
      this.projectSequences.set(id,sequence);
      for(const peer of this.projectPeers.get(id)??[])if(peer.active)this.send(peer,{type:'projectNegative',protocol:1,ownerEpoch:this.ownerEpoch,projectId:id,sequence});
    }
  }
  private registerProjectPeer(client:Client,projectId:string):void{
    if(!this.projectHintPort||!client.active||this.closing||this.stopped)throw Error('activity_project_forward_unsupported');
    let peers=this.projectPeers.get(projectId);
    if(!peers){peers=new Set();this.projectPeers.set(projectId,peers);}
    if(!peers.has(client)){
      let count=0;for(const values of this.projectPeers.values())if(values.has(client))count++;
      if(count>=512)throw Error('activity_project_read_capacity');
      peers.add(client);this.send(client,{type:'projectNegative',protocol:1,ownerEpoch:this.ownerEpoch,projectId,sequence:this.projectSequences.get(projectId)??0});
    }
  }
  private assertProjectEnvelopeCurrent(raw:unknown):void{
    const record=raw&&typeof raw==='object'?this.projectEnvelopes.get(raw):undefined;
    if(!record)throw Error('activity_project_return_unverified');
    this.service.assertProjectWorkReadCurrent(record.view,this.actor);
    if(record.stamp)this.store.assertProjectForwardSnapshot(record.stamp,record.view);
    if((this.projectSequences.get(record.projectId)??0)!==record.sequence)throw Error('activity_project_read_superseded');
  }
  private async projectWorkRead(client:Client,params:Record<string,unknown>,dismiss:boolean){
    if(!this.projectHintPort)throw Error('activity_project_forward_unsupported');
    const shape={watchId:key,projectId:key},dismissInput=dismiss?z.object({...shape,dismiss:z.object({expectedProjectionVersion:z.number().int().nonnegative().safe(),expectedPresentationIncarnation:z.string().uuid()}).strict()}).strict().parse(params):undefined;
    const input=dismissInput??z.object(shape).strict().parse(params);
    const context=await this.service.authorizeRead(input.watchId,this.actor);
    if(context.watch.source!=='kswarm'||context.watch.workId!==input.projectId)throw Error('activity_source_forbidden');
    this.registerProjectPeer(client,input.projectId);
    const view=dismissInput?await this.service.dismissAttention(input.watchId,dismissInput.dismiss,this.actor):await this.service.getWork(input.watchId,this.actor);
    const stamp=this.service.captureProjectWorkSnapshot(view,this.actor),sequence=this.projectSequences.get(input.projectId)??0;
    const result={protocol:1,ownerEpoch:this.ownerEpoch,projectId:input.projectId,sequence,view,stamp};
    this.projectEnvelopes.set(result,{view,stamp,projectId:input.projectId,sequence});return result;
  }
  private assertNativeCredentialCurrent():NativeSourceCredential {
    const initial=this.nativeSourceCredential;if(!initial)throw Error('activity_native_source_unsupported');
    try{
      const current=readNativeSourceCredential(this.address);
      if(!timingSafeEqual(Buffer.from(current.token,'hex'),Buffer.from(initial.token,'hex')))throw Error('activity_native_source_credentials_changed');
      return initial;
    }catch(error){
      // Observed exposure or replacement cannot be healed by restoring mode or
      // accepting a new token. Keep the original cause private to this host.
      this.nativeSourceFailure=error;this.nativeSourceCredential=undefined;
      try{this.options.onError?.(error);}catch(diagnosticError){this.nativeSourceFailure=new AggregateError([error,diagnosticError],'activity_native_source_diagnostic_failed');}
      throw Error('activity_native_source_unsupported');
    }
  }
  private assertNativeSourceClient(client:Client):void{
    this.assertNativeCredentialCurrent();
    if(!this.nativeSourceClients.has(client)||!this.clients.has(client)||client.role!=='producer'||!client.active||client.socket.destroyed||this.closing||this.stopped)throw Error('activity_native_source_forbidden');
  }
  private async dispatch(client: Client, method: string, params: Record<string, unknown>): Promise<unknown> {
    const service = this.service, actor = this.actor;
    const producerWatch = (watchId: string) => {
      const watch = this.store.getWatch(watchId);
      if (client.role !== 'producer' || !watch || !client.active || this.stopped || !this.options.authorizeProducer(watch.origin.threadId, client.instanceId)) throw new Error('activity_producer_forbidden');
      return () => client.active && !this.stopped && this.options.authorizeProducer(watch.origin.threadId, client.instanceId);
    };
    switch (method) {
      case 'authorizeNativeSource': {
        this.nativeSourceClients.delete(client);
        const credential=this.assertNativeCredentialCurrent();
        const input=z.object({nativeSourceProtocol:z.literal(1),ownerEpoch:z.literal(this.ownerEpoch),token:z.string().regex(/^[a-f0-9]{64}$/)}).strict().safeParse(params);
        if(!input.success||client.role!=='producer'||!this.clients.has(client)||!client.active||client.socket.destroyed||this.closing||this.stopped
          ||!timingSafeEqual(Buffer.from(input.data.token,'hex'),Buffer.from(credential.token,'hex')))throw Error('activity_native_source_forbidden');
        this.nativeSourceClients.add(client);return {nativeSourceProtocol:1,ownerEpoch:this.ownerEpoch};
      }
      case 'attentionPrepare': return this.attentionReaders.prepare(client,params);
      case 'nativeReaderQualify': this.assertNativeSourceClient(client);return this.attentionReaders.qualifyNative(client,params);
      case 'attentionReaderRegister': return this.attentionReaders.register(client,params);
      case 'attentionBind': return this.attentionReaders.bind(client,params);
      case 'attentionForget': return this.attentionReaders.forget(client,params);
      case 'attentionReadBegin': return this.attentionReaders.begin(client,params);
      case 'attentionReadAbort': return this.attentionReaders.abort(client,params);
      case 'attentionReadFinalize': return this.attentionReaders.finalize(client,params);
      case 'status': z.object({}).strict().parse(params); return { generation: ACTIVITY_OWNER_GENERATION, ownerEpoch: this.ownerEpoch, rootHash: this.address.rootHash, profileId: this.options.profileId, pid: process.pid, configDigest: this.options.configDigest, ready: this.options.ready?.() ?? true,features:['attention_reader_birth_v1','attention_read_round_v1',...(this.projectHintPort?['project_work_read_v1']:[])],...(this.nativeSourceCredential?{nativeSourceProtocol:1}:{}) };
      case 'projectWorkRead': return this.projectWorkRead(client,params,false);
      case 'projectDismissRead': return this.projectWorkRead(client,params,true);
      case 'projectHint': {
        if(client.role!=='producer'||!this.projectHintPort)throw Error('activity_project_forward_unsupported');
        const input=z.object({projectId:key,nonce:z.string().uuid()}).strict().parse(params),watches=this.store.listWatches().filter(watch=>watch.source==='kswarm'&&watch.workId===input.projectId&&watch.status==='active');
        const current=()=>{if(!client.active||this.closing||this.stopped||!watches.length||watches.some(watch=>!this.options.authorizeProducer(watch.origin.threadId,client.instanceId)||JSON.stringify(this.store.getWatch(watch.watchId))!==JSON.stringify(watch)))throw Error('activity_producer_forbidden');};
        current();for(const watch of watches){await service.authorizeRead(watch.watchId,actor);current();}
        this.registerProjectPeer(client,input.projectId);current();const admission=this.projectHintPort(input.projectId);current();
        if(!admission||typeof admission.demandId!=='string'||!(admission.settled instanceof Promise))throw Error('activity_project_hint_unconfirmed');
        this.projectHintNonces.set(input.projectId,input.nonce);
        void admission.settled.then(()=>{
          if(this.closing||this.stopped||this.projectHintNonces.get(input.projectId)!==input.nonce)return;
          // Routing only: same-head requalification has no new semantic fact
          // for Service.publish. Never send this for ordinary foreground reads.
          const sequence=this.projectSequences.get(input.projectId)??0;
          for(const peer of this.projectPeers.get(input.projectId)??[])if(peer.active)this.send(peer,{type:'projectSettled',protocol:1,ownerEpoch:this.ownerEpoch,projectId:input.projectId,sequence});
        },error=>this.options.onError?.(error));
        return{protocol:1,ownerEpoch:this.ownerEpoch,projectId:input.projectId,nonce:input.nonce,sequence:this.projectSequences.get(input.projectId)??0};
      }
      case 'list': { const input = z.object({ threadId: key, afterLocalSeq: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(200).optional() }).strict().parse(params); return service.listActivities(input.threadId, actor, input); }
      case 'work': return service.getWork(z.object({ watchId: key }).strict().parse(params).watchId, actor);
      case 'authorizeRead': {const input=z.object({watchId:key}).strict().parse(params),current=producerWatch(input.watchId);
        const result=await service.authorizeRead(input.watchId,actor);if(!current()||this.closing)throw Error('activity_producer_forbidden');
        service.assertCurrentUserRead(input.watchId,actor);return result;}
      case 'unread': z.object({}).strict().parse(params); return service.unreadThreads(actor);
      case 'read': { const input = z.object({ threadId: key, through: z.number().int().nonnegative() }).strict().parse(params); return service.markRead(input.threadId, input.through, actor); }
      case 'reporting': { const input = z.object({ watchId: key, preference: z.enum(['normal','critical_only','quiet']), revision: z.number().int().nonnegative() }).strict().parse(params); return service.updateReporting(input.watchId, input.preference, input.revision, actor); }
      case 'stop': { const input = z.object({ watchId: key, revision: z.number().int().nonnegative() }).strict().parse(params); const result = await service.stopWatch(input.watchId, input.revision, actor); this.options.stopWatch?.(input.watchId); return result; }
      case 'subscribe': {
        const input = z.object({ threadId: key, subscriptionId: key }).strict().parse(params);
        client.subscriptions.get(input.subscriptionId)?.(); client.subscriptions.set(input.subscriptionId, service.subscribe(input.threadId, actor, change => this.send(client, { type: 'change', subscriptionId: input.subscriptionId, change }))); return;
      }
      case 'unsubscribe': { const input = z.object({ subscriptionId: key }).strict().parse(params); client.subscriptions.get(input.subscriptionId)?.(); client.subscriptions.delete(input.subscriptionId); return; }
      case 'overview': { const input = z.object({ subscriptionId: key }).strict().parse(params); client.subscriptions.get(input.subscriptionId)?.(); client.subscriptions.set(input.subscriptionId, service.subscribeOverview(actor, change => this.send(client, { type: 'change', subscriptionId: input.subscriptionId, change }))); return; }
      case 'prepare': {
        const input = z.object({ threadId: key, operationId: key, creationIdempotencyKey: key }).strict().parse(params);
        if (client.role !== 'producer' || !this.options.authorizeProducer(input.threadId, client.instanceId) || !client.active) throw new Error('activity_producer_forbidden');
        return service.prepareAssociation(input, actor);
      }
      case 'bind': {
        if (client.role !== 'producer') throw new Error('activity_producer_forbidden');
        const parsed = z.object({ operationId: key, watchId: key, source: z.enum(['kswarm','task_host','agent_group','mcp']), logicalSourceId: key, sourceDataEpoch: key, workId: key, runId: key.optional(), actualExecutionThreadId: key.optional(), mcpReference: z.object({ endpointId: key, generation: z.enum(['v1','v2']), taskId: key, originalOperation: z.literal('tools/call') }).strict().optional() }).strict().parse(params);
        const { mcpReference, ...input } = parsed;
        if(this.attentionReaders.hasBirth(input.operationId))throw Error('attention_reader_birth_required');
        const origin = this.store.getAssociation(input.operationId)?.origin;
        if (!origin || !this.options.authorizeProducer(origin.threadId, client.instanceId) || !client.active) throw new Error('activity_producer_forbidden');
        const reference = mcpReference ? (mcpReference.generation === 'v1' ? { ...mcpReference, taskId: taskId(mcpReference.taskId), generation: 'v1' as const } : { ...mcpReference, taskId: taskId(mcpReference.taskId), generation: 'v2' as const }) : undefined;
        const watch = await service.bindWork(input, reference); await this.options.watchBound?.(watch.watchId); return watch;
      }
      case 'ingest': {
        if (client.role !== 'producer') throw new Error('activity_producer_forbidden');
        const input = z.object({ watchId: key, event: z.unknown() }).strict().parse(params);
        const watch = this.store.getWatch(input.watchId);
        if (!watch || !this.options.authorizeProducer(watch.origin.threadId, client.instanceId)) throw new Error('activity_producer_forbidden');
        return service.acceptEvent(input.watchId, input.event, () => client.active && !this.stopped && this.options.authorizeProducer(watch.origin.threadId, client.instanceId));
      }
      case 'retainedPage': {
        const input = z.object({ watchId: key, page: z.object({ sourceDataEpoch: key, coveredThrough: z.number().int().nonnegative(), events: z.array(z.unknown()).max(200), gapRanges: z.array(z.object({ from: z.number().int().positive(), through: z.number().int().positive(), reason: z.enum(['progress_compacted','retention_expired','mixed_retention_compaction']) }).strict()).max(201) }).strict() }).strict().parse(params);
        const current = producerWatch(input.watchId);
        return service.acceptRetainedPage(input.watchId, input.page, current);
      }
      case 'reconcile': {
        const input = z.object({ watchId: key, epoch: key, sequence: z.number().int().nonnegative(), state: z.enum(['accepted','queued','running','blocked','input_required','completed','failed','cancelled']), historyGap: z.boolean() }).strict().parse(params);
        const current = producerWatch(input.watchId);
        return service.reconcileSnapshot(input.watchId, input.epoch, input.sequence, input.state, input.historyGap, current);
      }
      case 'presented': {
        const input = z.object({ threadId: key, surface: z.literal('cli'), through: z.number().int().nonnegative() }).strict().parse(params);
        if (client.role !== 'producer' || !this.options.authorizeProducer(input.threadId, client.instanceId)) throw new Error('activity_producer_forbidden');
        this.store.markPresented(this.options.profileId, input.threadId, input.surface, input.through); return;
      }
      case 'mcpRegister': case 'mcpInputs': case 'mcpAnswer': case 'mcpCancel': {
        if (method === 'mcpRegister' && client.role !== 'producer' || !this.options.mcpRequest) throw new Error('activity_method_forbidden');
        const result=await this.options.mcpRequest(method, params, client.id);
        if(method==='mcpRegister')this.attentionReaders.noteMcpRegistration(client,params);return result;
      }
      case 'sourceProtected': case 'sourceRestart': case 'sourceEnsure': {
        if (client.role !== 'producer' || !this.options.sourceControl) throw new Error('activity_method_forbidden');
        return this.options.sourceControl(method, params);
      }
      case 'hint': {
        if (client.role !== 'producer') throw new Error('activity_producer_forbidden');
        const input = z.object({ source: z.enum(['kswarm','agent_group']), workId: key }).strict().parse(params);
        await this.options.sourceHint?.(input.source, input.workId); return;
      }
      case 'canReadSource': { const { watchId } = z.object({ watchId: key }).strict().parse(params); producerWatch(watchId); return service.canReadSource(watchId); }
      case 'freshness': { const { watchId } = z.object({ watchId: key }).strict().parse(params); producerWatch(watchId); return service.confirmFreshness(watchId); }
      case 'unavailable': { if (client.role !== 'producer') throw new Error('activity_method_forbidden'); const input = z.object({ watchId: key, freshness: z.enum(['reconnecting','unavailable']), errorCode: key }).strict().parse(params); producerWatch(input.watchId); return service.sourceUnavailable(input.watchId, input.freshness, input.errorCode); }
      case 'forgetAssociation': { if (client.role !== 'producer') throw new Error('activity_method_forbidden'); const input = z.object({ operationId: key }).strict().parse(params); const association = this.store.getAssociation(input.operationId); if (!association || !this.options.authorizeProducer(association.origin.threadId, client.instanceId)) throw new Error('activity_producer_forbidden'); if(this.attentionReaders.hasBirth(input.operationId))throw Error('attention_reader_birth_required');return service.forgetUnboundAssociation(input.operationId); }
      case 'deleted': { if (client.role !== 'producer') throw new Error('activity_method_forbidden'); const input = z.object({ threadId: key, operationId: key }).strict().parse(params); const thread = this.options.getThread(input.threadId); if (!thread || thread.deleteState === 'none') throw new Error('activity_deletion_unconfirmed'); return service.handleThreadDeletion(input.threadId, input.operationId); }
      default: throw new Error('activity_method_forbidden');
    }
  }

  stop(): Promise<void> {
    return this.stopping ??= (async () => {
      await this.sealAndDrain();
      await this.service.close();
      this.stopped = true;
      if (this.idleTimer) (this.options.clearInterval ?? clearInterval)(this.idleTimer);
      if (this.server) await new Promise<void>(resolve => this.server!.close(() => resolve()));
      this.store.close();
    })();
  }
}
