import { LegacyContinuityImporter, type LegacySourceInspector } from './legacy.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskSnapshot } from '../../shared/task-types.js';
import type { PublicTaskInput } from '../../shared/context-continuity-types.js';
import type { TaskCreateInput as HostTaskCreateInput } from '../../../src/runtime/task-host/types.js';
import type { ContinuityIpcPort } from './ipc.js';
import { resolveDesktopProfile,type DesktopProfileIdentity } from './profile.js';
import { ContinuityService } from './service.js';
import { TaskContinuitySource } from './task-source.js';
import { assembleOwnedHistory } from './history.js';
import type { TaskCreateContext } from '../../../src/runtime/task-host/types.js';
import type {InputOwnerDependencies,ContinuityInputJournal} from './input-journal.js';
import { ContinuityMcpController } from './mcp-control.js';
import { CliArchiveImporter } from './cli-archive.js';
import { getConfigDir } from '../../../src/utils/config.js';
import type {ContinuityStore} from './store.js';
export interface OriginalRuntimeSourceContext {readonly service:ContinuityService;readonly store:ContinuityStore;readonly actor:Readonly<ContinuityIpcPort['actor']>;}
let originalSourceContext:(runtime:DesktopContextContinuity)=>OriginalRuntimeSourceContext;
/** Actual original context only; no caller port/current/inspect field dispatch. */
export function originalDesktopRuntimeSourceContext(runtime:DesktopContextContinuity):OriginalRuntimeSourceContext{return originalSourceContext(runtime);}

/** Lazy for untouched legacy profiles; an existing continuity DB is opened at startup. */
export class DesktopContextContinuity {
  #sourceClosed=false;#sourceContext?:OriginalRuntimeSourceContext;
  static {originalSourceContext=runtime=>{if(!runtime||typeof runtime!=='object'||!(#sourceClosed in runtime)||runtime.#sourceClosed||!runtime.#sourceContext)throw new Error('canonical_runtime_source_unavailable');const context=runtime.#sourceContext;if(context.service.store!==context.store||runtime.#sourceClosed)throw new Error('canonical_runtime_source_unavailable');return context;};}
  private current: ContinuityIpcPort | null = null;
  private source: TaskContinuitySource | null = null;
  private closed = false;
  private initializationFailed = false;
  private legacyInspector?: LegacySourceInspector;
  private scopePolicy?: (id: string) => 'readable' | 'blocked' | 'deleted';
  private deletionGuard?:()=>void;
  private pending = new Set<Promise<unknown>>();
  private inputDependencies?:InputOwnerDependencies;
  private inputOwner?:ContinuityInputJournal;
  private inputAdmittedSources=new Map<string,string>();
  configureInputOwner(dependencies:InputOwnerDependencies):void{if(this.inputDependencies)throw new Error('input_owner_already_bound');this.inputDependencies=dependencies;}
  inputs():ContinuityInputJournal{
    if(this.closed||!this.inputDependencies)throw new Error('input_owner_unavailable');
    return this.inputOwner??(this.inputOwner=this.port().service.bindInputOwner({...this.inputDependencies,isExistingAdmission:snapshot=>this.inputAdmittedSources.get(snapshot.taskId)===snapshot.sessionId}));
  }
  assertInputAdmission(snapshot:TaskSnapshot):void{
    const hasOwner=this.inputOwner||this.current?.service.store.db.prepare('SELECT 1 FROM conversation_inputs WHERE task_id=? OR conversation_id=? LIMIT 1').get(snapshot.taskId,snapshot.context?.threadId??'');
    if(hasOwner||snapshot.inputPreparation)this.inputs().assertAdmission(snapshot);
    this.inputAdmittedSources.set(snapshot.taskId,snapshot.sessionId);
  }
  async settleInput(snapshot:TaskSnapshot):Promise<void>{
    if(this.closed||!this.inputOwner)return;const row=this.port().service.store.db.prepare('SELECT input_id FROM conversation_inputs WHERE task_id=? AND deleted=0').get(snapshot.taskId);
    if(row){try{await this.inputOwner.reconcile(String(row.input_id));}catch{try{this.inputOwner.markClaimUnknown(String(row.input_id));}catch{/* An unavailable owner cannot relax the original claim. */}}}
  }
  private ownerReady=false;
  private effectInventoryState:'not_required'|'pending'|'ready'|'failed'='not_required';
  private preparedEffectRuns=new Map<string,string>();
  constructor(private readonly dataRoot: string, private readonly inspect?: (taskId: string) => Promise<TaskSnapshot | null>,private readonly identity?:DesktopProfileIdentity|null, private readonly authOwnerTarget?:import('./ipc.js').AuthOwnerIpcTarget) {
    if(identity===null){this.initializationFailed=true;return;}
    if (existsSync(join(dataRoot, 'continuity.sqlite'))) { try { this.port(); } catch { this.initializationFailed = true; } }
  }
  port(): ContinuityIpcPort {
    if (this.closed || this.initializationFailed) throw new Error('continuity_unavailable');
    if (!this.current) {
      let profileId:string,service:ContinuityService;
      try{profileId=(this.identity??resolveDesktopProfile(this.dataRoot)).profileId;service=new ContinuityService({dbPath:join(this.dataRoot,'continuity.sqlite'),profileId});}
      catch{this.initializationFailed=true;throw new Error('continuity_unavailable');}
      const actor = { requestSource: 'user' as const, profileId, actorId: `desktop-user:${profileId}` };
      this.current = { service, authOwner: this.authOwnerTarget, actor, refresh: () => this.reconcile(), ...(this.legacyInspector ? { importer: new LegacyContinuityImporter(service, actor, this.legacyInspector) } : {}) };
      this.#sourceContext=Object.freeze({service,store:service.store,actor:Object.freeze({...actor})});
      this.current.cliArchive=new CliArchiveImporter(service,actor,join(getConfigDir(),'sessions'));
      this.current.mcp=new ContinuityMcpController(service,actor,()=>this.reconcile(),()=>this.ownerReady&&!this.closed);
      if (this.scopePolicy) service.setScopePolicy(this.scopePolicy);
      service.setDeletionGuard(()=>this.assertDeletionOwnerReady());
      this.source = new TaskContinuitySource(service, actor);
    }
    return this.current;
  }
  configureScopePolicy(policy: (id: string) => 'readable' | 'blocked' | 'deleted'): void { this.scopePolicy = policy; this.current?.service.setScopePolicy(policy); }
  private assertDeletionOwnerReady():void{if(['pending','failed'].includes(this.effectInventoryState))throw new Error('blocked_unsettled');this.deletionGuard?.();}
  configureDeletionGuard(guard:()=>void):void{this.deletionGuard=guard;this.current?.service.setDeletionGuard(()=>this.assertDeletionOwnerReady());}
  requireEffectInventory():void{this.effectInventoryState='pending';}
  async auditEffectInventory(read:()=>Promise<TaskSnapshot[]>,legacyOwnerPresent:boolean):Promise<void>{
    this.effectInventoryState='pending';
    try{const snapshots=await read();if(this.closed)throw new Error('continuity_stopping');const p=this.port();p.service.completeEffectInventory(p.actor,snapshots,legacyOwnerPresent);this.effectInventoryState='ready';}
    catch(error){this.effectInventoryState='failed';throw error;}
  }
  registerGuardedSnapshot(snapshot:TaskSnapshot):void{const p=this.port();p.service.registerGuardedRun(p.actor,snapshot.taskId,snapshot.sessionId);this.preparedEffectRuns.set(snapshot.taskId,snapshot.sessionId);}
  async restoreMcpAfterOwnerReady():Promise<void>{if(this.closed||this.initializationFailed)return;this.ownerReady=true;await this.current?.mcp?.restore();}
  configureLegacy(inspect: LegacySourceInspector): void {
    this.legacyInspector = inspect;
    if (this.current) this.current.importer = new LegacyContinuityImporter(this.current.service, this.current.actor, inspect);
  }
  bindPrepared(input: HostTaskCreateInput, taskId: string, inspect: (taskId: string) => Promise<TaskSnapshot | null>,
    publicInput?: PublicTaskInput, sourceKind: 'desktop_task' | 'native_codex' = 'desktop_task'): Promise<void> {
    if (this.closed) return Promise.reject(new Error('continuity_stopping'));
    const id = input.context?.threadId;
    if (!this.current || !id || !this.current.service.getConversation(this.current.actor, id)) return Promise.resolve();
    const run = this.source!.bindPrepared({ conversationId: id, taskId, publicPrompt: publicInput?.prompt ?? input.prompt, includeUser: publicInput?.includeUser ?? true, sourceKind }, async value => {
      const snapshot = await inspect(value);
      if (this.closed) throw new Error('continuity_stopping');
      return snapshot;
    });
    this.pending.add(run); void run.finally(() => this.pending.delete(run)).catch(() => undefined);
    return run;
  }
  capture(snapshot: TaskSnapshot, receipt?: import('./task-source.js').SourceSettlementReceipt): void {
    if (this.closed || !this.source) return;
    if(receipt?.physicallySettled){
      // Recovery/admission-failure finalizers can observe an old terminal file.
      // Only this boot's newly prepared owner can mint its one physical proof.
      if(this.preparedEffectRuns.get(snapshot.taskId)!==snapshot.sessionId)receipt=undefined;
      else this.preparedEffectRuns.delete(snapshot.taskId);
    }
    try { this.source.capture(snapshot, receipt); }
    catch {
      // Keep optional projection failure out of execution/Goal/artifact settlement.
      try { this.current!.service.store.db.prepare('INSERT INTO projection_failures VALUES (?,?) ON CONFLICT(task_id) DO UPDATE SET code=excluded.code').run(snapshot.taskId, 'reconciliation_required'); } catch { /* next read reconciles every bound source, even if this store write failed */ }
      console.warn('[context-continuity] projection requires reconciliation');
    }
  }
  async reconcile(inspect = this.inspect): Promise<void> {
    if (this.closed || !this.current || !inspect) return;
    const run = (async () => {
      const tasks = this.current!.service.store.db.prepare('SELECT task_id FROM task_bindings WHERE revoked=0').all();
      for (const task of tasks) {
        if (this.closed) return;
        try { const snapshot = await inspect(String(task.task_id)); if (!this.closed && snapshot) this.capture(snapshot); }
        catch { /* missing/unreadable owner does not grant access or mutate execution */ }
      }
    })();
    this.pending.add(run);
    try { await run; } finally { this.pending.delete(run); }
  }
  assertTaskHistoryReadable(taskId: string, conversationId?: string): void {
    this.assertTaskReadable(taskId);
    this.port().service.assertHistorySourceClosed(taskId);
    if (!this.current || !conversationId || !this.current.service.getConversation(this.current.actor, conversationId)) return;
    const row = this.current.service.store.db.prepare('SELECT conversation_id,revoked FROM task_bindings WHERE task_id=?').get(taskId);
    if (!row || row.revoked || row.conversation_id !== conversationId) throw new Error('not_readable');
  }
  assembleOwnedHistory(taskId: string, context?: TaskCreateContext) {
    if (this.initializationFailed || this.closed) throw new Error('continuity_unavailable');
    return this.current ? assembleOwnedHistory(this.current.service, this.current.actor, taskId, context) : null;
  }
  recordLoadedHistory(taskId: string, sources: TaskSnapshot[], conversationId?: string): void {
    if (this.initializationFailed || this.closed) throw new Error('continuity_unavailable');
    const p=this.port();p.service.recordEffectHistory(p.actor,taskId,sources,Boolean(conversationId&&p.service.getConversation(p.actor,conversationId)));
  }
  assertConversationContentReadable(conversationId: string): void {
    if (this.initializationFailed || this.closed) throw new Error('continuity_unavailable');
    if (!this.current) return;
    const { service, actor } = this.current, conversation = service.getConversation(actor, conversationId);
    if (conversation) for (const taskId of conversation.taskIds) service.assertTaskReadable(taskId);
  }
  consumeAgentContent(input: { threadId: string; receiverTaskId?: string; sourceTaskIds: Array<string | undefined> }): void {
    if (this.initializationFailed || this.closed) throw new Error('continuity_unavailable');
    if (!this.current) return;
    const { service, actor } = this.current;
    if (!service.getConversation(actor, input.threadId)) return;
    if (!input.receiverTaskId || input.sourceTaskIds.some(id => !id)) throw new Error('not_readable');
    service.assertTaskReadable(input.receiverTaskId);
    const receiver = service.store.db.prepare('SELECT conversation_id,revoked FROM task_bindings WHERE task_id=?').get(input.receiverTaskId);
    if (!receiver || receiver.revoked || receiver.conversation_id !== input.threadId) throw new Error('not_readable');
    service.recordSourceTasks(actor, input.receiverTaskId, input.sourceTaskIds as string[]);
  }
  inheritTaskContext(sourceTaskId: string, receiverTaskId?: string): void {
    if (this.initializationFailed || this.closed) throw new Error('continuity_unavailable');
    if (!this.current) return;
    const source = this.current.service.store.db.prepare('SELECT conversation_id FROM task_bindings WHERE task_id=?').get(sourceTaskId);
    if (source) this.consumeAgentContent({ threadId: String(source.conversation_id), receiverTaskId, sourceTaskIds: [sourceTaskId] });
  }
  recordUnprovenEffect(taskId:string,invocationId:string,toolName:string):void{
    if(this.closed||this.initializationFailed)throw new Error('continuity_unavailable');
    // Also initializes the durable marker for unbound/lazy legacy execution. Such work has
    // no reliable source provenance, so its unknown closure conservatively blocks this profile.
    const {service,actor}=this.port();service.recordUnprovenEffect(actor,taskId,invocationId,toolName);
  }
  assertTaskReadable(taskId: string): void { if (this.initializationFailed) throw new Error('continuity_unavailable'); if (this.current) this.current.service.assertTaskReadable(taskId); }
  assertNativeExecutionAvailable():void{
    if(this.initializationFailed||this.closed)throw new Error('continuity_unavailable');
    // The current native protocol proves a parent turn, not its descendant/process closure.
    throw new Error('native_execution_gate_unavailable');
  }
  assertConversationDeletionSafe(id:string):void{
    if(this.initializationFailed||this.closed)throw new Error('continuity_unavailable');
    this.assertDeletionOwnerReady();
    this.current?.service.assertConversationDeletionSafe(this.current.actor,id);
  }
  acquireNativeContext(taskId:string,routeTaskIds:string[]):void{
    this.assertNativeExecutionAvailable();
  }
  forgetDeletedConversation(id: string): void { if (!this.closed && this.current) this.current.service.tombstoneConversation(this.current.actor, id); }
  async close(): Promise<void> {
    this.#sourceClosed=true;
    if (this.closed) return;
    this.closed = true;this.inputOwner?.close();await this.inputOwner?.drainClosed();await this.current?.mcp?.close(); await Promise.allSettled([...this.pending]); this.current?.service.close();
  }
}
