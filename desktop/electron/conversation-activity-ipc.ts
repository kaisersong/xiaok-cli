import {assertBeforeEffects} from '../../src/runtime/verification/before-effects.js';
import { z } from 'zod';
import type { IpcMainInvokeEvent } from 'electron';
import type { IpcHandleRegistrar } from './shutdown-aware-ipc-main.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { ActivityActor, ActivityChange } from '../../src/runtime/conversation-activity/service.js';
import type { ConversationActivity, ReportingPreference } from '../../src/runtime/conversation-activity/types.js';
import { workAttentionSchema, type WorkAttention } from '../../src/runtime/conversation-activity/attention-projector.js';
import {nativeActivityQuestionFormsSchema,type NativeActivityQuestionForm,type NativeActivityAnswer} from '../shared/native-activity-question-contract.js';

export type NativeActivityReadAdmission=Readonly<{kind:'native_activity_read_v1'}>;
interface NativeReadProof {owner:object;actor:ActivityActor;active:boolean;current():void}
const nativeReadProofs=new WeakMap<NativeActivityReadAdmission,NativeReadProof>();
/** Inspection only. Issuance exists solely inside the registered IPC handler. */
export function inspectNativeActivityReadAdmission(frame:unknown,owner:object):Readonly<{actor:ActivityActor;assertCurrent():void}>{
  const proof=frame&&typeof frame==='object'?nativeReadProofs.get(frame as NativeActivityReadAdmission):undefined;
  if(!proof||!proof.active||proof.owner!==owner)throw Error('activity_native_read_forbidden');
  proof.current();return Object.freeze({actor:proof.actor,assertCurrent:()=>{if(!proof.active)throw Error('activity_native_read_forbidden');proof.current();}});
}
export interface NativeActivityTaskReadPort {authorize(event:IpcMainInvokeEvent):{actorId:string}|null}

const key = z.string().min(1).max(256);
const state = z.enum(['accepted', 'queued', 'running', 'blocked', 'input_required', 'completed', 'failed', 'cancelled']);
const activity = z.object({
  activityId: key, localSeq: z.number().int().nonnegative(), watchId: key, threadId: key,
  kind: z.enum(['accepted', 'started', 'heartbeat', 'progress', 'artifact_available', 'blocked', 'input_required', 'completed', 'failed', 'cancelled', 'report', 'diagnostic']),
  at: z.number().finite(), projection: z.object({
    watchId: key, executionState: state, businessOutcome: z.enum(['unknown', 'success', 'error', 'cancelled']),
    freshness: z.enum(['fresh', 'reconnecting', 'stale', 'unavailable']), sourceSequence: z.number().int().nonnegative(), revision: z.number().int().nonnegative(),
    lastProgressAt: z.number().nullable(), lastHeartbeatAt: z.number().nullable(), lastReportAt: z.number().nullable(),
    summary: z.string().optional(), errorCode: z.string().optional(), evidenceRefs: z.array(z.string()),
  }).strict(),
}).strict();
const watch = z.object({
  operationId: key, watchId: key, source: z.enum(['kswarm', 'task_host', 'agent_group', 'mcp']),
  logicalSourceId: key, sourceDataEpoch: key, workId: key, runId: z.string().max(256).optional(), actualExecutionThreadId: key.optional(),
  origin: z.object({ profileId: key, threadId: key, workspaceId: key, actorId: key }).strict(),
  status: z.enum(['active', 'stopped']), generation: z.number().int().nonnegative(),
  preference: z.enum(['normal', 'critical_only', 'quiet']), policyRevision: z.number().int().nonnegative(), nextReportDueAt: z.number().finite(),
}).strict();
// Keep root/runtime and Desktop dependency schema types out of one recursively
// inferred Zod tree. Validation still uses the same strict production contract.
const presentationSchema = z.custom<WorkAttention>(value => workAttentionSchema.safeParse(value).success);
const workView = z.object({ watch, projection: activity.shape.projection,questionSourceKind:z.literal('codex_native_approval').optional(), presentation: presentationSchema.optional(),attentionState:z.object({presentationIncarnation:z.string().uuid(),dismissed:z.boolean()}).strict().optional() }).strict().superRefine((value, context) => {
  if (value.watch.watchId !== value.projection.watchId || value.presentation && value.presentation.workRef !== value.watch.workId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'activity_presentation_identity_conflict' });
  }
});

export interface ConversationActivityIpcService {
  dismissAttention?(watchId: string, input: { expectedProjectionVersion: number; expectedPresentationIncarnation: string }, actor: ActivityActor,admission?:NativeActivityReadAdmission): Promise<unknown>;
  nativeQuestions?(watchId:string,actor:ActivityActor,admission:NativeActivityReadAdmission):Promise<NativeActivityQuestionForm[]>;
  nativeAnswer?(watchId:string,input:NativeActivityAnswer,actor:ActivityActor,admission:NativeActivityReadAdmission):Promise<void>;
  assertNativeReadResultCurrent?(raw:unknown,admission:NativeActivityReadAdmission):void;
  /** Final original output check; caller identity is re-derived by this IPC. */
  assertReadResultCurrent?(raw:unknown,actor:ActivityActor):void;
  mcpInputs?(watchId: string, actor: ActivityActor): Promise<unknown>;
  mcpAnswer?(watchId: string, input: { inputId: string; expectedDigest: string; action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }, actor: ActivityActor): Promise<void>;
  mcpCancel?(watchId: string, actor: ActivityActor): Promise<{ requested: true }>;
  list(threadId: string, actor: ActivityActor, page?: { afterLocalSeq?: number; limit?: number }): Promise<ConversationActivity[]>;
  subscribe(threadId: string, actor: ActivityActor, handler: (change: ActivityChange) => void): (() => void) | Promise<() => void>;
  reporting(watchId: string, preference: ReportingPreference, revision: number, actor: ActivityActor): Promise<unknown>;
  stop(watchId: string, revision: number, actor: ActivityActor): Promise<unknown>;
  getWork(watchId: string, actor: ActivityActor,admission?:NativeActivityReadAdmission): Promise<unknown>;
  unread(actor: ActivityActor): Array<{ threadId: string; count: number }> | Promise<Array<{ threadId: string; count: number }>>;
  read(threadId: string, through: number, actor: ActivityActor): void | Promise<void>;
  overview(actor: ActivityActor, handler: (change: ActivityChange) => void): (() => void) | Promise<() => void>;
}

export function registerConversationActivityIpc(
  registrar: IpcHandleRegistrar, service: ConversationActivityIpcService | null,
  authorize: (event: IpcMainInvokeEvent) => { actorId: string } | null,
  taskReadPort?:NativeActivityTaskReadPort,
): () => void {
  const subscriptions = new Map<string, () => void>();
  const pendingSubscriptions = new Map<string, symbol>();
  let disposed = false;
  const readOutputChecks=new WeakMap<object,{check():void;release():void}>();
  const actor = (event: IpcMainInvokeEvent): ActivityActor => {
    const identity = authorize(event);
    if (!identity) throw new Error('activity_actor_forbidden');
    return { ...identity, requestSource: 'user' };
  };
  const get = () => { if (!service) throw new Error('activity_unavailable'); return service; };
  const captureRead=(event:IpcMainInvokeEvent,identity:ActivityActor,required:boolean)=>{
    const owner=get();let task:{actorId:string}|null;
    // Only initial capture may retain the ordinary/MCP compatibility path.
    // A suspended source operation is never retried under a weaker actor.
    try{task=taskReadPort?.authorize(event)??null;if(!task||task.actorId!==identity.actorId||event.sender.isDestroyed())throw Error('activity_native_read_forbidden');}
    catch(error){if(required)throw Error('activity_native_read_forbidden',{cause:error});return undefined;}
    const frame=Object.freeze({kind:'native_activity_read_v1' as const});
    const proof:NativeReadProof={owner,actor:Object.freeze({...identity}),active:true,current(){
      if(disposed||!proof.active||event.sender.isDestroyed()||taskReadPort?.authorize(event)?.actorId!==proof.actor.actorId)throw Error('activity_native_read_forbidden');
    }};
    nativeReadProofs.set(frame,proof);
    return {frame,current:()=>{inspectNativeActivityReadAdmission(frame,owner);},release:()=>{proof.active=false;nativeReadProofs.delete(frame);}};
  };
  const read=async<O>(event:IpcMainInvokeEvent,run:(identity:ActivityActor,frame?:NativeActivityReadAdmission)=>Promise<unknown>,parse:(raw:unknown)=>O,required=false,native=true):Promise<O>=>{
    if(disposed)throw Error('activity_unavailable');
    const identity=actor(event),owner=get(),scope=native?captureRead(event,identity,required):undefined;
    let handed=false;
    try{
      scope?.current();const raw=await run(identity,scope?.frame);scope?.current();const result=parse(raw);
      if(!result||typeof result!=='object')throw Error('activity_read_output_invalid');
      if(scope&&!owner.assertNativeReadResultCurrent)throw Error('activity_native_read_forbidden');
      const parsed=result as {watch?:{source?:string};presentation?:{deliveryStage?:string};attentionState?:unknown};
      if(parsed.watch?.source==='kswarm'&&(parsed.attentionState||parsed.presentation&&parsed.presentation.deliveryStage!=='none')&&!owner.assertReadResultCurrent)throw Error('activity_project_return_unverified');
      readOutputChecks.set(result,{check(){
        if(disposed||get()!==owner||event.sender.isDestroyed())throw Error('activity_actor_forbidden');
        const current=actor(event);if(current.actorId!==identity.actorId)throw Error('activity_actor_forbidden');
        scope?.current();
        if(owner.assertReadResultCurrent)assertBeforeEffects(()=>owner.assertReadResultCurrent!(raw,current));
        if(scope){
          const returned:unknown=owner.assertNativeReadResultCurrent!(raw,scope.frame);
          if(returned!==undefined){
            // Observe an invalid asynchronous tail while retaining the original
            // Native contract code. Errors thrown by the verifier stay original.
            try{assertBeforeEffects(()=>returned);}catch(error){throw Error('activity_native_read_guard_invalid',{cause:error});}
          }
        }
        if(disposed||event.sender.isDestroyed()||actor(event).actorId!==identity.actorId)throw Error('activity_actor_forbidden');scope?.current();
      },release:()=>scope?.release()});
      handed=true;return result;
    }finally{if(!handed)scope?.release();}
  };

  const register = <I, O>(channel: string, input: z.ZodType<I>, output: z.ZodType<O>, handler: (input: I, event: IpcMainInvokeEvent) => Promise<O>) =>
    registerIpcHandler({ registrar, channel, input, output, handler,outputCheck(result){if(!result||typeof result!=='object')return;const check=readOutputChecks.get(result);if(!check)return;readOutputChecks.delete(result);try{check.check();}finally{check.release();}},sourceFile: 'conversation-activity-ipc.ts', rolloutRound: 3, riskTags: ['internal-mutation'] });

  register('desktop:activity:list', z.object({ threadId: key, afterLocalSeq: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(200).optional() }).strict(), z.array(activity),
    async (input, event) => read(event,identity=>get().list(input.threadId,identity,{afterLocalSeq:input.afterLocalSeq,limit:input.limit}),raw=>z.array(activity).parse(raw),false,false));
  register('desktop:activity:work', z.object({ watchId: key }).strict(), workView, async (input, event) => read(event,(identity,frame)=>frame?get().getWork(input.watchId,identity,frame):get().getWork(input.watchId,identity),raw=>workView.parse(raw)));
  register('desktop:activity:attention:dismiss', z.object({ watchId: key, expectedProjectionVersion: z.number().int().nonnegative().safe(), expectedPresentationIncarnation: z.string().uuid() }).strict(), workView, async (input, event) => {
    const handler = get().dismissAttention;
    if (!handler) throw new Error('attention_inventory_unavailable');
    const { watchId, ...expected } = input;
    return read(event,(identity,frame)=>frame?handler(watchId,expected,identity,frame):handler(watchId,expected,identity),raw=>workView.parse(raw));
  });
  const nativeForms=z.custom<NativeActivityQuestionForm[]>(value=>nativeActivityQuestionFormsSchema.safeParse(value).success).transform(value=>nativeActivityQuestionFormsSchema.parse(value));
  register('desktop:activity:nativeQuestions',z.object({watchId:key}).strict(),nativeForms,async(input,event)=>read(event,async(identity,frame)=>{
    const handler=get().nativeQuestions;if(!handler||!frame)throw Error('activity_native_read_forbidden');return handler(input.watchId,identity,frame);
  },raw=>nativeForms.parse(raw),true));
  register('desktop:activity:nativeAnswer',z.object({watchId:key,questionRef:key,expectedDigest:z.string().regex(/^[a-f0-9]{64}$/),choiceId:z.enum(['approve','deny'])}).strict(),z.void(),async(input,event)=>{
    const identity=actor(event),scope=captureRead(event,identity,true)!;
    try{scope.current();const handler=get().nativeAnswer;if(!handler)throw Error('activity_native_read_forbidden');const {watchId,...answer}=input;await handler(watchId,answer,identity,scope.frame);}
    finally{scope.release();}
    // The original owner checks admission at resolve. Its accepted void ACK is
    // not converted to a retryable failure by a later window/metadata change.
  });
  const field = z.object({ key, title: z.string().max(256), type: z.enum(['text','number','boolean','choice','choices']), required: z.boolean(), options: z.array(z.string().max(4096)).max(128).optional() }).strict();
  register('desktop:activity:mcpInputs', z.object({ watchId: key }).strict(), z.array(z.object({ inputId: key, expectedDigest: key, prompt: z.string().max(1024), fields: z.array(field).max(32) }).strict()).max(32), async (input, event) => {
    const handler = get().mcpInputs; if (!handler) throw new Error('activity_mcp_unavailable'); return handler(input.watchId, actor(event)) as Promise<any>;
  });
  register('desktop:activity:mcpAnswer', z.object({ watchId: key, inputId: key, expectedDigest: key, action: z.enum(['accept','decline','cancel']), content: z.record(z.unknown()).optional() }).strict(), z.void(), async (input, event) => {
    const handler = get().mcpAnswer; if (!handler) throw new Error('activity_mcp_unavailable'); const { watchId, ...answer } = input; await handler(watchId, answer, actor(event));
  });
  register('desktop:activity:mcpCancel', z.object({ watchId: key }).strict(), z.object({ requested: z.literal(true) }).strict(), async (input, event) => {
    const handler = get().mcpCancel; if (!handler) throw new Error('activity_mcp_unavailable'); return handler(input.watchId, actor(event));
  });
  register('desktop:activity:unread', z.void(), z.array(z.object({ threadId: key, count: z.number().int().positive() }).strict()), async (_input, event) => get().unread(actor(event)));
  register('desktop:activity:read', z.object({ threadId: key, throughLocalSeq: z.number().int().nonnegative() }).strict(), z.void(), async (input, event) => get().read(input.threadId, input.throughLocalSeq, actor(event)));
  const subscription = z.object({ threadId: key, subscriptionId: key }).strict();
  register('desktop:activity:subscribe', subscription, z.void(), async (input, event) => {
    const identity = actor(event), sender = event.sender;
    const subscriptionKey = `${sender.id}:${input.subscriptionId}`;
    subscriptions.get(subscriptionKey)?.();
    const token = Symbol('activity-subscription'); pendingSubscriptions.set(subscriptionKey, token);
    let dispose: () => void;
    try { dispose = await get().subscribe(input.threadId, identity, change => {
      if (!sender.isDestroyed()) sender.send('desktop:activity:changed', change);
    }); } catch (error) {
      if (pendingSubscriptions.get(subscriptionKey) === token) pendingSubscriptions.delete(subscriptionKey);
      throw error;
    }
    if (disposed || sender.isDestroyed() || pendingSubscriptions.get(subscriptionKey) !== token) { dispose(); return; }
    try { if (actor(event).actorId !== identity.actorId) throw new Error('activity_actor_forbidden'); }
    catch (error) { dispose(); pendingSubscriptions.delete(subscriptionKey); throw error; }
    const cleanup = () => { dispose(); subscriptions.delete(subscriptionKey); pendingSubscriptions.delete(subscriptionKey); sender.removeListener('destroyed', cleanup); };
    subscriptions.set(subscriptionKey, cleanup); sender.once('destroyed', cleanup);
  });
  register('desktop:activity:unsubscribe', z.object({ subscriptionId: key }).strict(), z.void(), async (input, event) => {
    actor(event); const subscriptionKey = `${event.sender.id}:${input.subscriptionId}`;
    pendingSubscriptions.delete(subscriptionKey); subscriptions.get(subscriptionKey)?.();
  });
  register('desktop:activity:overview', z.object({ subscriptionId: key }).strict(), z.void(), async (input, event) => {
    const identity = actor(event), sender = event.sender, subscriptionKey = `${sender.id}:${input.subscriptionId}`;
    subscriptions.get(subscriptionKey)?.();
    const token = Symbol('activity-overview'); pendingSubscriptions.set(subscriptionKey, token);
    const stop = await get().overview(identity, change => { if (!sender.isDestroyed()) sender.send('desktop:activity:changed', change); });
    if (disposed || sender.isDestroyed() || pendingSubscriptions.get(subscriptionKey) !== token) { stop(); return; }
    const cleanup = () => { stop(); pendingSubscriptions.delete(subscriptionKey); subscriptions.delete(subscriptionKey); sender.removeListener('destroyed', cleanup); };
    subscriptions.set(subscriptionKey, cleanup); sender.once('destroyed', cleanup);
  });
  register('desktop:activity:reporting', z.object({ watchId: key, preference: z.enum(['normal', 'critical_only', 'quiet']), expectedPolicyRevision: z.number().int().nonnegative() }).strict(), watch,
    async (input, event) => watch.parse(await get().reporting(input.watchId, input.preference, input.expectedPolicyRevision, actor(event))));
  register('desktop:activity:stop', z.object({ watchId: key, expectedPolicyRevision: z.number().int().nonnegative() }).strict(), watch,
    async (input, event) => watch.parse(await get().stop(input.watchId, input.expectedPolicyRevision, actor(event))));
  return () => { disposed = true; pendingSubscriptions.clear(); for (const stop of [...subscriptions.values()]) stop(); subscriptions.clear(); };
}
