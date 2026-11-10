import { assertObserverPromiseAmbient, observeTrustedObserverPromise, ObserverNativePromise } from './observer-promise-contract.js';
import { Ajv } from 'ajv';
import { createHash,randomUUID } from 'node:crypto';
import type { McpClientConnection } from '../../platform/mcp/transport.js';
import type { McpTaskObserver } from '../../platform/mcp/tasks.js';
import type { SerializedTaskReference } from '@modelcontextprotocol/ext-tasks/client';
import type { ConversationActivityStore } from './store.js';
import type { ConversationActivityApi } from './service.js';
import type { WorkKind, WorkWatch, McpInputForm } from './types.js';
import type { ActivityActor } from './service.js';
import { normalizeMcpRuntimeToolResult } from '../../ai/mcp/runtime/client.js';
import { parseMcpInputForms } from './mcp-input-forms.js';
import {attentionInventorySchema,type AttentionInventory} from './attention-canonical-state.js';
import type {AttentionReaderSlot} from './attention-reader-owner.js';
import type {PreparedMcpReaderAssociation} from './service.js';

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;

/** Host-owned connections and serialized handles, independent of renderer lifetime. */
export class ConversationMcpActivities {
  private readonly connections = new Map<string, McpClientConnection>();
  private readonly preparations=new Map<string,Promise<void>>();
  private readonly readerIncarnations=new WeakMap<McpClientConnection,string>();
  private readonly readerBindings=new Map<string,{connection:McpClientConnection;reference:SerializedTaskReference;watch:WorkWatch;incarnation:string}>();
  private readonly endpoints = new Set<string>();
  private readonly reads = new Map<string, Promise<void>>();
  private readonly readRequests=new Map<string,{watch:WorkWatch;reference:SerializedTaskReference;connection:McpClientConnection;identity:string;requested:number}>();
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly delays = new Map<string, number>();
  private readonly restorations = new Map<string, Promise<void>>();
  private readonly controllers = new Map<string, AbortController>();
  private disposed = false;
  private closing?: Promise<void>;
  private readonly callbackWork = new Set<Promise<void>>();
  /** Reserve before calling any observer/read producer that may reenter close. */
  private ownCallback<T>(begin: () => Promise<T>): Promise<T> {
    assertObserverPromiseAmbient(); // Before Promise chains AND actual producer.
    let completed!: () => void, failed!: (error: unknown) => void;
    const reservation = new ObserverNativePromise<void>((resolve, reject) => { completed = resolve; failed = reject; });
    this.callbackWork.add(reservation);
    observeTrustedObserverPromise(reservation, () => { this.callbackWork.delete(reservation); }, () => { this.callbackWork.delete(reservation); });
    try {
      // All begin sites below return this module's own native async Promise.
      // No raw.then access; native await skips own then and Symbol.species.
      const raw = begin();
      observeTrustedObserverPromise(raw, completed, failed);
      return raw;
    } catch (error) { failed(error); return ObserverNativePromise.reject(error); }
  }
  constructor(private readonly options: { store: ConversationActivityStore; service: ConversationActivityApi; actorId: string;
    assertLocalUserRead?(watch:WorkWatch,actor:ActivityActor):void;
    endpointReady?(connection: McpClientConnection): Promise<void>;
    externalObserver?(connection: McpClientConnection): boolean;
    originThread(taskId: string): Promise<string | null>; onError?(error: unknown): void }) {}

  register(connection: McpClientConnection): void {
    const endpoint = connection.tasks?.endpointId;
    if (!endpoint || this.disposed) return;
    if(!this.readerIncarnations.has(connection))this.readerIncarnations.set(connection,randomUUID());
    if (this.connections.get(endpoint) === connection) {
      if (!this.options.externalObserver?.(connection)) for (const watch of this.options.store.listWatches()) if (watch.source === 'mcp' && watch.logicalSourceId === endpoint && watch.status === 'active') void this.restore(watch, connection).catch(error => this.options.onError?.(error));
      return;
    }
    this.endpoints.add(endpoint); this.connections.set(endpoint, connection);
    const close = connection.client.onclose;
    connection.client.onclose = () => {
      try { close?.(); } finally {
        if (this.connections.get(endpoint) === connection) {
          this.connections.delete(endpoint);
          for (const watch of this.options.store.listWatches()) if (watch.source === 'mcp' && watch.logicalSourceId === endpoint)
            void this.options.service.sourceUnavailable(watch.watchId, 'unavailable', 'activity_mcp_disconnected').catch(error => this.options.onError?.(error));
        }
      }
    };
    for (const watch of this.options.store.listWatches()) if (!this.options.externalObserver?.(connection) && watch.source === 'mcp' && watch.logicalSourceId === endpoint && watch.status === 'active') {
      void this.restore(watch, connection).catch(error => this.options.onError?.(error));
    }
  }

  canObserve(watch: WorkWatch): boolean {
    const reference = this.options.store.getMcpReference(watch.watchId);
    return Boolean(reference && this.endpoints.has(reference.endpointId) && reference.endpointId === watch.logicalSourceId && reference.taskId === watch.workId);
  }

  private async userWork(watchId: string, actor: ActivityActor) {
    const { watch } = await (this.options.service.authorizeRead?this.options.service.authorizeRead(watchId,actor):this.options.service.getWork(watchId, actor));
    if (watch.source !== 'mcp' || !await this.options.service.canReadSource(watchId)) throw new Error('activity_source_forbidden');
    const reference = this.options.store.getMcpReference(watchId);
    const connection = reference && this.connections.get(reference.endpointId);
    if (!reference || !connection?.tasks) throw new Error('activity_mcp_disconnected');
    const result={ watch, reference, connection, actor };
    this.assertCurrentUserWork(result);return result;
  }
  private assertCurrentUserWork(context:{watch:WorkWatch;reference:SerializedTaskReference;connection:McpClientConnection;actor:ActivityActor}):void{
    if(this.disposed||this.connections.get(context.reference.endpointId)!==context.connection)throw Error('activity_mcp_connection_superseded');
    if(this.options.assertLocalUserRead)this.options.assertLocalUserRead(context.watch,context.actor);
    else if(this.options.service.assertCurrentUserRead)this.options.service.assertCurrentUserRead(context.watch.watchId,context.actor);
    else throw Error('activity_native_identity_unavailable');
    const current=this.options.store.getWatch(context.watch.watchId),reference=this.options.store.getMcpReference(context.watch.watchId);
    if(!current||current.status!=='active'||current.generation!==context.watch.generation
      ||['source','logicalSourceId','sourceDataEpoch','workId','runId'].some(key=>current[key as keyof WorkWatch]!==context.watch[key as keyof WorkWatch])
      ||JSON.stringify(current.origin)!==JSON.stringify(context.watch.origin)||JSON.stringify(reference)!==JSON.stringify(context.reference))throw Error('activity_source_superseded');
  }
  private async authorizeCurrentUserWork(context:{watch:WorkWatch;reference:SerializedTaskReference;connection:McpClientConnection;actor:ActivityActor}):Promise<void>{
    this.assertCurrentUserWork(context);
    if(!await this.options.service.canReadSource(context.watch.watchId))throw Error('activity_source_forbidden');
    this.assertCurrentUserWork(context);
  }
  async inputs(watchId: string, actor: ActivityActor): Promise<McpInputForm[]> {
    const context=await this.userWork(watchId, actor),{ reference, connection }=context;this.assertCurrentUserWork(context);
    const task = await connection.tasks!.task(reference.taskId).snapshot();
    await this.authorizeCurrentUserWork(context);
    this.assertCurrentUserWork(context);
    if (task.status !== 'input_required') return [];
    return parseMcpInputForms(task.raw.inputRequests);
  }
  assertAttentionInventoryCurrent(slot:AttentionReaderSlot,actor:ActivityActor){
    if(slot.sourceKind==='codex_native_approval')throw Error('attention_inventory_unavailable');
    const binding=this.readerBindings.get(slot.watchId);
    if(!binding||binding.incarnation!==slot.readerIncarnation||JSON.stringify(canonical(binding.reference))!==JSON.stringify(canonical(slot.reference)))throw Error('attention_inventory_unavailable');
    this.assertCurrentUserWork({...binding,actor});return binding;
  }
  hasAttentionReaderBinding(watchId:string):boolean{return !this.disposed&&this.readerBindings.has(watchId);}
  collectAttentionInventory(slot:AttentionReaderSlot,actor:ActivityActor):Promise<AttentionInventory>{
    if(this.disposed)return ObserverNativePromise.reject(Error('activity_mcp_connection_superseded'));
    return this.ownCallback(async()=>{
      const binding=this.assertAttentionInventoryCurrent(slot,actor),context={...binding,actor};await this.authorizeCurrentUserWork(context);this.assertAttentionInventoryCurrent(slot,actor);
      const task=await binding.connection.tasks!.task(binding.reference.taskId).snapshot();this.assertAttentionInventoryCurrent(slot,actor);
      const legacy=task.status==='completed'&&binding.reference.generation==='v1'?await binding.connection.tasks!.task(binding.reference.taskId).result():undefined;
      this.assertAttentionInventoryCurrent(slot,actor);await this.authorizeCurrentUserWork(context);this.assertAttentionInventoryCurrent(slot,actor);
      const forms=task.status==='input_required'?parseMcpInputForms(task.raw.inputRequests):[],result=(legacy?('result' in legacy?legacy.result:undefined):task.raw.result) as Record<string,unknown>|undefined;
      return attentionInventorySchema.parse({watchId:slot.watchId,readerIncarnation:binding.incarnation,taskStatus:task.status,
        businessOutcome:task.status==='completed'?(result?.isError===true?'error':'success'):task.status==='failed'?'error':task.status==='cancelled'?'cancelled':'unknown',
        questions:forms.map(form=>({inputId:form.inputId,expectedDigest:form.expectedDigest}))});
    });
  }
  async answerInput(watchId: string, input: { inputId: string; expectedDigest: string; action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }, actor: ActivityActor): Promise<void> {
    const form = (await this.inputs(watchId, actor)).find(form => form.inputId === input.inputId);
    if (!form || form.expectedDigest !== input.expectedDigest) throw new Error('activity_mcp_input_stale');
    if (input.action === 'accept') {
      const content = input.content ?? {};
      if (Object.keys(content).some(key => !form.fields.some(field => field.key === key))) throw new Error('activity_mcp_input_invalid');
      for (const field of form.fields) {
        const value = content[field.key];
        if (value === undefined && !field.required) continue;
        const valid = field.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
          : field.type === 'boolean' ? typeof value === 'boolean'
          : field.type === 'choices' ? Array.isArray(value) && value.length <= 128 && value.every(item => typeof item === 'string' && (!field.options || field.options.includes(item)))
          : typeof value === 'string' && value.length <= 4096 && (!field.options || field.options.includes(value));
        if (!valid) throw new Error('activity_mcp_input_invalid');
      }
    }
    const context=await this.userWork(watchId, actor),{watch, reference, connection}=context;this.assertCurrentUserWork(context);
    const latest = await connection.tasks!.task(reference.taskId).snapshot();
    await this.authorizeCurrentUserWork(context);
    this.assertCurrentUserWork(context);
    const request = (latest.raw.inputRequests as Record<string, { params?: { requestedSchema?: object } }> | undefined)?.[input.inputId];
    if (latest.status !== 'input_required' || !request || createHash('sha256').update(JSON.stringify(canonical(request))).digest('hex') !== input.expectedDigest) throw new Error('activity_mcp_input_stale');
    if (input.action === 'accept') {
      if (!request.params?.requestedSchema || Buffer.byteLength(JSON.stringify(request.params.requestedSchema)) > 64 * 1024) throw new Error('activity_mcp_input_invalid');
      try { if (!new Ajv({ strict: false, validateFormats: false }).compile(request.params.requestedSchema)(input.content ?? {})) throw new Error('activity_mcp_input_invalid'); }
      catch { throw new Error('activity_mcp_input_invalid'); }
    }
    await this.authorizeCurrentUserWork(context);
    this.assertCurrentUserWork(context);
    await connection.tasks!.task(reference.taskId).updateJson({ [input.inputId]: { action: input.action, ...(input.action === 'accept' ? { content: input.content ?? {} } : {}) } });
    await this.observeAcknowledgedUserEffect(watch, reference, connection);
  }
  async cancel(watchId: string, actor: ActivityActor): Promise<{ requested: true }> {
    const context=await this.userWork(watchId, actor),{watch, reference, connection}=context;this.assertCurrentUserWork(context);
    await this.authorizeCurrentUserWork(context);
    this.assertCurrentUserWork(context);
    await connection.tasks!.cancelTask(reference.taskId);
    await this.observeAcknowledgedUserEffect(watch, reference, connection);
    return { requested: true };
  }

  private reportAcknowledgedObservationError(error:unknown):void{
    // A diagnostic hook failure cannot undo the acknowledged remote request.
    try{this.options.onError?.(error);}catch{
      try{console.error('[conversation-activity] activity_mcp_observation_diagnostic_failed');}catch{/* Receipt remains acknowledged. */}
    }
  }
  private async observeAcknowledgedUserEffect(watch:WorkWatch,reference:SerializedTaskReference,connection:McpClientConnection):Promise<void>{
    // Only entered AFTER the original remote operation fulfilled. Its own error
    // still propagates unchanged; a later source read is a separate observation.
    try{await this.observe(watch,reference,connection);}catch(error){this.reportAcknowledgedObservationError(error);return;}
    void this.restore(watch,connection).catch(error=>this.reportAcknowledgedObservationError(error));
  }

  observer(taskId: string, invocationId: string, connection: McpClientConnection): Promise<McpTaskObserver | undefined> {
    if (this.disposed) return ObserverNativePromise.resolve(undefined);
    return this.ownCallback(async () => {
      const endpoint=connection.tasks?.endpointId;if(!endpoint)return;
      const previous=this.preparations.get(endpoint);let release!:()=>void;
      const reservation=new ObserverNativePromise<void>(resolve=>{release=resolve;});this.preparations.set(endpoint,reservation);
      try{if(previous)await previous;return await this.createObserver(taskId,invocationId,connection);}
      finally{release();if(this.preparations.get(endpoint)===reservation)this.preparations.delete(endpoint);}
    });
  }
  private async createObserver(taskId: string, invocationId: string, connection: McpClientConnection): Promise<McpTaskObserver | undefined> {
    const current=()=>!this.disposed&&!!connection.tasks?.capabilities.execution&&this.connections.get(connection.tasks.endpointId)===connection;
    if (!current()) return;
    await this.options.endpointReady?.(connection);
    if (!current()) return;
    const threadId = await this.options.originThread(taskId);
    if (!threadId || !current()) return;
    const operationId = `mcp:${invocationId}`;
    const actor:ActivityActor={requestSource:'user',actorId:this.options.actorId},incarnation=this.readerIncarnations.get(connection)!;
    let readerBirth:PreparedMcpReaderAssociation|undefined;
    if(connection.activityEndpoint?.config.type==='stdio'&&this.options.service.registerMcpReader&&this.options.service.prepareMcpReaderAssociation&&this.options.service.bindMcpReaderWork){
      const supported=await this.options.service.registerMcpReader(connection.tasks!.endpointId,incarnation,actor);
      if(!current())return;
      if(supported)readerBirth=await this.options.service.prepareMcpReaderAssociation({threadId,operationId,creationIdempotencyKey:operationId},actor);
    }
    if(!current())return;
    if(!readerBirth)await this.options.service.prepareAssociation({ threadId, operationId, creationIdempotencyKey: operationId }, actor);
    if (!current()) return;
    let watch: WorkWatch | undefined;
    return {
      handle: reference => {
        if (this.disposed || this.connections.get(reference.endpointId) !== connection) return ObserverNativePromise.reject(new Error('activity_mcp_connection_superseded'));
        return this.ownCallback(async () => {
          const binding={ operationId, watchId: operationId, source: 'mcp' as const, logicalSourceId: reference.endpointId,sourceDataEpoch: operationId, workId: reference.taskId, runId: invocationId };
          watch = readerBirth?await this.options.service.bindMcpReaderWork!(binding,reference,readerBirth,actor):await this.options.service.bindWork(binding, reference);
          if(readerBirth&&!this.disposed&&this.connections.get(reference.endpointId)===connection){
            const saved=this.options.store.getMcpReference(watch.watchId);if(!saved||JSON.stringify(canonical(saved))!==JSON.stringify(canonical(reference)))throw Error('attention_inventory_unavailable');
            this.readerBindings.set(watch.watchId,{connection,reference:saved,watch:structuredClone(watch),incarnation});
          }
          if (!this.disposed && !this.options.externalObserver?.(connection)) this.schedule(watch, reference, connection);
        });
      },
      event: async reference => { if (!this.disposed && watch && !this.options.externalObserver?.(connection)) await this.observe(watch, reference, connection); },
      unavailable: () => {
        if (this.disposed || !watch) return ObserverNativePromise.resolve();
        const watchId = watch.watchId;
        return this.ownCallback(async () => { await this.options.service.sourceUnavailable(watchId, 'reconnecting', 'activity_mcp_subscription_unavailable'); });
      },
      detached: () => { if (!this.disposed && watch && !this.options.externalObserver?.(connection)) void this.restore(watch, connection).catch(error => this.options.onError?.(error)); },
      immediate: () => { if (!this.disposed){if(readerBirth&&this.options.service.forgetMcpReaderAssociation)
        void this.ownCallback(()=>this.options.service.forgetMcpReaderAssociation!(readerBirth!,actor)).catch(error=>this.options.onError?.(error));
        else this.options.service.forgetUnboundAssociation(operationId);} },
    };
  }

  private observe(watch: WorkWatch, reference: SerializedTaskReference, connection: McpClientConnection): Promise<void> {
    if (this.disposed || this.connections.get(reference.endpointId) !== connection) return ObserverNativePromise.resolve();
    const identity=JSON.stringify([watch.operationId,watch.source,watch.logicalSourceId,watch.sourceDataEpoch,watch.workId,watch.runId??'',watch.actualExecutionThreadId??'',watch.generation,
      [watch.origin.profileId,watch.origin.workspaceId,watch.origin.threadId,watch.origin.actorId],reference.endpointId,reference.generation,reference.taskId,reference.originalOperation]);
    const existing=this.reads.get(watch.watchId),request=this.readRequests.get(watch.watchId);
    if(existing&&request){
      if(!Number.isSafeInteger(request.requested+1))return ObserverNativePromise.reject(Error('activity_mcp_read_revision_exhausted'));
      Object.assign(request,{watch,reference,connection,identity,requested:request.requested+1});return existing;
    }
    return this.ownCallback(()=>{
      let completed!:()=>void,failed!:(error:unknown)=>void;
      const shared=new ObserverNativePromise<void>((resolve,reject)=>{completed=resolve;failed=reject;});
      const demand={watch,reference,connection,identity,requested:1};
      // Publish the original shared promise and its demand before any method
      // lookup can synchronously reenter observation or close.
      this.readRequests.set(watch.watchId,demand);this.reads.set(watch.watchId,shared);
      const raw=(async()=>{
        let served=0;
        try{
          while(!this.disposed&&served<demand.requested){
            const source={watch:demand.watch,reference:demand.reference,connection:demand.connection,identity:demand.identity};
            const same=()=>demand.connection===source.connection&&demand.identity===source.identity;
            const current=()=>!this.disposed&&same()&&this.connections.get(source.reference.endpointId)===source.connection;
            if(!await this.options.service.canReadSource(source.watch.watchId)||!current()){if(!this.disposed&&!same())continue;return;}
            const signal=this.controllers.get(source.watch.watchId)?.signal;if(signal?.aborted)return;
            const controller=source.connection.tasks!.task(source.reference.taskId),snapshot=controller.snapshot;
            if(!current()){if(!this.disposed&&!same())continue;return;}if(signal?.aborted)return;
            // A hint which precedes this actual SDK read is covered by it. A
            // hint arriving during any later await requires another read.
            const started=demand.requested;
            const task=await Reflect.apply(snapshot,controller,[signal]);
            if(!current()){if(!this.disposed&&!same())continue;return;}
            this.delays.set(source.watch.watchId,Math.max(30_000,task.suggestedPollIntervalMs??0));
            const kind:WorkKind=task.status==='working'?'progress':task.status;
            const legacyOutcome=task.status==='completed'&&source.reference.generation==='v1'?await source.connection.tasks!.task(source.reference.taskId).result({signal}):undefined;
            if(!current()){if(!this.disposed&&!same())continue;return;}
            const result=(legacyOutcome?('result'in legacyOutcome?legacyOutcome.result:undefined):task.raw.result)as Record<string,unknown>|undefined;
            await this.options.service.acceptEvent(source.watch.watchId,{schemaVersion:1,
              eventId:createHash('sha256').update(JSON.stringify(canonical(task.raw))).digest('hex'),source:'mcp',
              logicalSourceId:source.watch.logicalSourceId,sourceDataEpoch:source.watch.sourceDataEpoch,workId:source.watch.workId,runId:source.watch.runId,
              transportGeneration:source.watch.generation,kind,sourceRevision:task.lastUpdatedAt,receivedAt:Date.now(),
              summary:(task.statusMessage??(result?normalizeMcpRuntimeToolResult(result).summary:undefined))?.slice(0,1024),evidenceRefs:[],
              ...(task.status==='completed'?{businessOutcome:result?.isError===true?'error':'success'}:{})},current);
            if(!current()){if(!this.disposed&&!same())continue;return;}
            await this.options.service.confirmFreshness(source.watch.watchId);
            served=started;
          }
        }finally{
          if(this.reads.get(watch.watchId)===shared)this.reads.delete(watch.watchId);
          if(this.readRequests.get(watch.watchId)===demand)this.readRequests.delete(watch.watchId);
        }
      })();
      observeTrustedObserverPromise(raw,completed,failed);return shared;
    });
  }

  private schedule(watch: WorkWatch, reference: SerializedTaskReference, connection: McpClientConnection): void {
    if (this.disposed || this.retries.has(watch.watchId)) return;
    const timer = setTimeout(() => {
      this.retries.delete(watch.watchId);
      const latest = this.options.store.getWatch(watch.watchId);
      const projection = this.options.store.getProjection(watch.watchId);
      if (!latest || latest.status !== 'active' || this.disposed || this.connections.get(reference.endpointId) !== connection
        || projection && ['completed', 'failed', 'cancelled'].includes(projection.executionState)) return;
      void this.observe(latest, reference, connection).catch(async error => {
        this.options.onError?.(error);
        await this.options.service.sourceUnavailable(watch.watchId, 'unavailable', 'activity_mcp_handle_unrecoverable');
      }).finally(() => this.schedule(latest, reference, connection)).catch(error => this.options.onError?.(error));
    }, this.delays.get(watch.watchId) ?? 30_000);
    timer.unref?.(); this.retries.set(watch.watchId, timer);
  }

  private restore(watch: WorkWatch, connection: McpClientConnection): Promise<void> {
    if (this.disposed || this.connections.get(watch.logicalSourceId) !== connection) return ObserverNativePromise.resolve();
    const existing = this.restorations.get(watch.watchId); if (existing) return existing;
    return this.ownCallback(() => {
    const state: { finished: boolean; raw?: Promise<void> } = { finished: false };
    const pending = (async () => {
      try { await this.drive(watch, connection); }
      finally {
        state.finished = true;
        const registered = state.raw;
        if (registered && this.restorations.get(watch.watchId) === registered) this.restorations.delete(watch.watchId);
      }
    })();
    state.raw = pending;
    if (!state.finished) this.restorations.set(watch.watchId, pending);
    return pending;
    });
  }
  private async drive(watch: WorkWatch, connection: McpClientConnection): Promise<void> {
    if (this.controllers.has(watch.watchId) || this.disposed) return;
    const reference = this.options.store.getMcpReference(watch.watchId);
    if (!reference || !await this.options.service.canReadSource(watch.watchId)) return;
    if (this.controllers.has(watch.watchId) || this.disposed) return;
    const controller = new AbortController(); this.controllers.set(watch.watchId, controller);
    const terminal = () => ['completed','failed','cancelled'].includes(this.options.store.getProjection(watch.watchId)?.executionState ?? '');
    const refresh = async () => {
      await this.observe(watch, reference, connection);
      if (terminal()) controller.abort(new Error('activity_source_terminal'));
    };
    let stopHints: (() => void) | undefined;
    const ended = new Promise<void>(resolve => { if (controller.signal.aborted) resolve(); else controller.signal.addEventListener('abort', () => resolve(), { once: true }); });
    let subscription: Awaited<ReturnType<NonNullable<McpClientConnection['listenTaskEvents']>>> | undefined;
    try {
      try { stopHints = connection.observeTaskStatus?.(reference.taskId, () => { void refresh().catch(error => this.options.onError?.(error)); }); }
      catch (error) { this.options.onError?.(error); } // Bounded hint capacity keeps read-only polling available.
      // Background observation owns no SDK ToolExecution: only official
      // TaskController reads/updates and schema-validated notification hints.
      await refresh(); this.schedule(watch, reference, connection);
      if (controller.signal.aborted || this.disposed) return;
      if (reference.generation !== 'v2' || !connection.listenTaskEvents) { await ended; return; }
      let delay = 1000;
      while (!controller.signal.aborted && !this.disposed) {
        try {
          subscription = await connection.listenTaskEvents(connection.client, [reference.taskId], { timeout: 5000, signal: controller.signal });
          await refresh(); // snapshot-after-ACK closes the registration gap
          if (controller.signal.aborted) break;
          const reason = await Promise.race([subscription.closed, ended.then(() => 'local' as const)]);
          if (reason === 'local' || controller.signal.aborted) break;
          await this.options.service.sourceUnavailable(watch.watchId, 'reconnecting', 'activity_mcp_subscription_unavailable');
        } catch (error) {
          if (controller.signal.aborted || this.disposed) break;
          this.options.onError?.(error);
          await this.options.service.sourceUnavailable(watch.watchId, 'reconnecting', 'activity_mcp_subscription_unavailable');
        } finally { await subscription?.close(); subscription = undefined; }
        await Promise.race([ended, new Promise<void>(resolve => { const timer = setTimeout(resolve, delay); timer.unref(); ended.then(() => { clearTimeout(timer); resolve(); }); })]);
        delay = Math.min(30_000, delay * 2);
      }
    } catch (error) {
      if (!controller.signal.aborted && !this.disposed) {
        await this.options.service.sourceUnavailable(watch.watchId, 'unavailable', 'activity_mcp_handle_unrecoverable'); throw error;
      }
    } finally { stopHints?.(); await subscription?.close(); if (this.controllers.get(watch.watchId) === controller) this.controllers.delete(watch.watchId); }
  }

  stopWatch(watchId: string): void {
    this.controllers.get(watchId)?.abort(new Error('activity_watch_stopped'));
    const timer = this.retries.get(watchId); if (timer) clearTimeout(timer); this.retries.delete(watchId);
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    assertObserverPromiseAmbient();
    let completed!: () => void, failed!: (error: unknown) => void;
    this.closing = new ObserverNativePromise<void>((resolve, reject) => { completed = resolve; failed = reject; });
    const failures: unknown[] = [];
    try { this.dispose(); } catch (error) { failures.push(error); }
    const active = [...this.reads.values(), ...this.restorations.values(), ...this.callbackWork];
    // All work is already running and individually observed. Awaiting each real
    // native Promise does not allocate via ambient species or abandon siblings.
    void (async () => {
      for (const raw of active) { try { await raw; } catch (error) { failures.push(error); } }
      if (failures.length) failed(new AggregateError([...new Set(failures)], 'activity_mcp_observation_close_failed'));
      else completed();
    })();
    return this.closing;
  }
  dispose(): void {
    this.readerBindings.clear();
    this.disposed = true; for (const controller of this.controllers.values()) controller.abort(new Error('activity_owner_disposed'));
    for (const timer of this.retries.values()) clearTimeout(timer); this.retries.clear(); this.connections.clear(); this.endpoints.clear();
  }
}
