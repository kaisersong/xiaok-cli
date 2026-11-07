import {types} from 'node:util';
import {createIntrinsicSet,settleIntrinsicOperations} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {readOriginalWorkflowScriptChildrenPhysicalFate} from './kswarm-runtime-bridge.js';
import {assertBeforeEffects} from '../../src/runtime/verification/before-effects.js';
import {readOriginalWorkflowScriptRuntimeFate} from './workflow-script-worker.js';
import {readOriginalKSwarmWorkflowControllerIO,type OriginalKSwarmWorkflowControllerIO} from './kswarm-service.js';
import {workflowControllerOperationForRoute} from './workflow-controller-io-contract.js';
import {readCurrentOriginalRootExecutionContext} from '../../src/runtime/verification/original-root-execution-context.js';
import {readOptionalWorkflowScriptWorkerOrigin} from './workflow-script-worker-origin.js';
import {captureDispatchBusinessData} from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import {canonicalVerificationJson} from '../../src/runtime/verification/protocol.js';
import type { KSwarmService } from './kswarm-service.js';
import type {
  WorkflowScriptAgentInput,
  WorkflowScriptController,
  WorkflowScriptLogInput,
  WorkflowScriptParallelGroupInput,
  WorkflowScriptPhaseInput,
  WorkflowScriptTerminalResult,
} from './workflow-script-runtime.js';

interface WorkflowControllerOwner {readonly service:KSwarmService;readonly projectId:string;readonly workflowRunId:string;runtime?:object;io?:OriginalKSwarmWorkflowControllerIO;childBytes:number;guard?:()=>void;}
const controllerOwners=new WeakMap<WorkflowScriptController,WorkflowControllerOwner>();
const ownerGet=WeakMap.prototype.get,ownerSet=WeakMap.prototype.set,ownerApply=Reflect.apply,ownerFreeze=Object.freeze,ownerIsArray=Array.isArray,ownerBytes=Buffer.byteLength,OwnerMap=Map,OwnerPromise=Promise,ownerThen=Promise.prototype.then;
const childMapGet=Map.prototype.get,childMapSet=Map.prototype.set,childMapDelete=Map.prototype.delete,childMapSize=Object.getOwnPropertyDescriptor(Map.prototype,'size')!.get!,childMapEntries=Map.prototype.entries,childMapNext=Object.getPrototypeOf(new Map().entries()).next;
function childGet<K,V>(map:Map<K,V>,key:K):V|undefined{return ownerApply(childMapGet,map,[key]);}
function childEntries<K,V>(map:Map<K,V>):[K,V][]{const result:[K,V][]=[],iterator=ownerApply(childMapEntries,map,[]);for(;;){const step=ownerApply(childMapNext,iterator,[]) as IteratorResult<[K,V]>;if(step.done)break;result[result.length]=step.value;}return result;}

interface OriginalWorkflowChild {controller:WorkflowScriptController;scope:WorkflowControllerOwner;context:object;nodeId:string;expectedInput:unknown;ackInput?:unknown;handoffId?:string;attempt?:number;workflowId?:string;nodeKind?:string;confirmed:boolean;ack:Promise<void>;resolve():void;reject(raw:unknown):void;run:OriginalWorkflowRunChildren}
interface OriginalWorkflowRunChildren {pending:ReturnType<typeof createIntrinsicSet<Promise<void>>>;children:Map<string,OriginalWorkflowChild>}
const childIndex=new WeakMap<object,Map<string,OriginalWorkflowRunChildren>>();
const childViews=new WeakMap<object,{service:unknown;view:OriginalWorkflowScriptChildView}>();
export interface OriginalWorkflowScriptChildView {context:object;projectId:string;workflowRunId:string;nodeId:string;expectedInput:unknown;ackInput:unknown;handoffId:string|undefined;attempt:number|undefined;workflowId:string|undefined;nodeKind:string|undefined;assertLocal():void;assertCurrent():void}
export function readOriginalWorkflowScriptChildView(service:unknown,view:unknown):OriginalWorkflowScriptChildView{const row=view&&typeof view==='object'?ownerApply(ownerGet,childViews,[view]) as {service:unknown;view:OriginalWorkflowScriptChildView}|undefined:undefined;if(!row||row.service!==service)throw Error('WORKFLOW_CHILD_ORIGINAL_RELATION_REQUIRED');return row.view;}
export function readOriginalWorkflowScriptChildParent(service:unknown,view:unknown):WorkflowScriptController{const original=readOriginalWorkflowScriptChildView(service,view),index=ownerApply(ownerGet,childIndex,[service]) as Map<string,OriginalWorkflowRunChildren>|undefined,run=index?childGet(index,childKey(original.projectId,original.workflowRunId)):undefined,child=run?childGet(run.children,original.nodeId):undefined;if(!child||child.context!==original.context)throw Error('WORKFLOW_CHILD_ORIGINAL_RELATION_REQUIRED');return child.controller;}
export async function readOptionalOriginalWorkflowScriptChildRoot(service:unknown,projectId:string,runId:string,nodeId:string):Promise<OriginalWorkflowScriptChildView|null>{const index=service&&typeof service==='object'?ownerApply(ownerGet,childIndex,[service]) as Map<string,OriginalWorkflowRunChildren>|undefined:undefined;if(!index||!childGet(index,childKey(projectId,runId)))return null;return readOriginalWorkflowScriptChildRoot(service,projectId,runId,nodeId);}
function childKey(projectId:string,runId:string){return canonicalVerificationJson([projectId,runId]);}
/** A candidate is not a Host/model grant. Early handoffs wait only original
 * pending ACKs; a provider node ID is never guessed from the caller node ID. */
export async function readOriginalWorkflowScriptChildRoot(service:unknown,projectId:string,runId:string,nodeId:string){const index=service&&typeof service==='object'?ownerApply(ownerGet,childIndex,[service]) as Map<string,OriginalWorkflowRunChildren>|undefined:undefined,run=index?childGet(index,childKey(projectId,runId)):undefined;if(!run)throw Error('WORKFLOW_CHILD_ORIGINAL_RELATION_REQUIRED');if(!childGet(run.children,nodeId)){const pending=run.pending.snapshot();if(pending.length)await settleIntrinsicOperations(pending,value=>value);}const row=childGet(run.children,nodeId);if(!row)throw Error('WORKFLOW_CHILD_ACK_UNCONFIRMED');const local=()=>{if(!row.confirmed||childGet(run.children,nodeId)!==row)throw Error('WORKFLOW_CHILD_ACK_UNCONFIRMED');if(!row.scope.runtime)throw Error('WORKFLOW_CHILD_ORIGINAL_RELATION_REQUIRED');readOriginalWorkflowScriptRuntimeFate(row.controller,row.scope.runtime).assertOpen();const origin=readOptionalWorkflowScriptWorkerOrigin(row.controller);if(!origin||origin.executionContext!==row.context)throw Error('WORKFLOW_CHILD_ORIGINAL_RELATION_REQUIRED');origin.assertLocal();};local();const view=ownerFreeze({context:row.context,projectId,workflowRunId:runId,nodeId,expectedInput:row.expectedInput,ackInput:row.ackInput,handoffId:row.handoffId,attempt:row.attempt,workflowId:row.workflowId,nodeKind:row.nodeKind,assertLocal:local,assertCurrent(){local();readOptionalWorkflowScriptWorkerOrigin(row.controller)!.assertCurrent();local();}});ownerApply(ownerSet,childViews,[view,{service,view}]);return view;}
function registerOriginalChild(controller:WorkflowScriptController,scope:WorkflowControllerOwner,body:unknown):OriginalWorkflowChild|null{const context=readCurrentOriginalRootExecutionContext();if(context===null)return null;const origin=readOptionalWorkflowScriptWorkerOrigin(controller);if(!origin||origin.executionContext!==context||!scope.runtime)throw Error('WORKFLOW_CHILD_ORIGINAL_RELATION_REQUIRED');origin.assertLocal();readOriginalWorkflowScriptRuntimeFate(controller,scope.runtime).assertOpen();const input=captureDispatchBusinessData(body,()=>{},true),size=ownerBytes(canonicalVerificationJson(input));if(scope.childBytes+size>4194304)throw Error('WORKFLOW_CHILD_CAPACITY');let index=ownerApply(ownerGet,childIndex,[scope.service]) as Map<string,OriginalWorkflowRunChildren>|undefined;if(!index){index=new OwnerMap();ownerApply(ownerSet,childIndex,[scope.service,index]);}for(const [key,old]of childEntries(index)){let live=old.pending.size>0;for(const [,child]of childEntries(old.children))try{if(child.scope.runtime){readOriginalWorkflowScriptRuntimeFate(child.controller,child.scope.runtime).assertOpen();live=true;}}catch{}if(!live)ownerApply(childMapDelete,index,[key]);}if((ownerApply(childMapSize,index,[]) as number)>=4096)throw Error('WORKFLOW_CHILD_CAPACITY');const key=childKey(scope.projectId,scope.workflowRunId);let run=childGet(index,key);if(!run){run={pending:createIntrinsicSet<Promise<void>>(),children:new OwnerMap()};ownerApply(childMapSet,index,[key,run]);}let resolve!:()=>void,reject!:(raw:unknown)=>void;const ack=new OwnerPromise<void>((yes,no)=>{resolve=yes;reject=no;});run.pending.add(ack);void ownerApply(ownerThen,ack,[()=>run!.pending.delete(ack),()=>run!.pending.delete(ack)]);const row={controller,scope,context,nodeId:'',expectedInput:input,confirmed:false,ack,resolve,reject,run};scope.childBytes+=size;return row;}
function confirmOriginalChild(row:OriginalWorkflowChild|null,nodeId:string,reply:unknown){if(!row)return;try{if(!nodeId)throw Error('WORKFLOW_CHILD_ACK_UNCONFIRMED');const run=readRecord(readRecord(reply).workflowRun),origin=readOptionalWorkflowScriptWorkerOrigin(row.controller);if(!origin||run.id!==row.scope.workflowRunId||run.projectId!==row.scope.projectId||run.source!=='script_generated'||run.scriptHash!==origin.scriptHash||!ownerIsArray(run.nodes))throw Error('WORKFLOW_CHILD_ACK_UNCONFIRMED');let node:unknown;for(let i=0;i<run.nodes.length;i++){const candidate=run.nodes[i];if(isRecord(candidate)&&candidate.id===nodeId)node=candidate;}if(!isRecord(node)||node.kind!=='agent_task'||!isRecord(node.input))throw Error('WORKFLOW_CHILD_ACK_UNCONFIRMED');const runtime=readRecord(node.runtime);row.nodeId=nodeId;row.ackInput=captureDispatchBusinessData(node.input);row.handoffId=readString(runtime.handoffId);row.attempt=typeof node.attempt==='number'?node.attempt:undefined;row.workflowId=readString(run.workflowId);row.nodeKind='agent_task';row.confirmed=true;ownerApply(childMapSet,row.run.children,[nodeId,row]);row.resolve();}catch(raw){row.reject(raw);throw raw;}}

export function bindOriginalWorkflowControllerRuntime(controller:unknown,reference:object):void{const owner=controller&&typeof controller==='object'?ownerApply(ownerGet,controllerOwners,[controller]) as WorkflowControllerOwner|undefined:undefined;if(!owner)throw Error('WORKFLOW_ROOT_CONTROLLER_REQUIRED');readOriginalWorkflowScriptRuntimeFate(controller,reference);if(owner.runtime&&owner.runtime!==reference)throw Error('WORKFLOW_WORKER_ALREADY_STARTED');owner.runtime=reference;}
export function readOriginalWorkflowControllerPhysicalFate(controller:unknown):{waitKnown():Promise<void>;assertKnown():void}{
 const owner=controller&&typeof controller==='object'?ownerApply(ownerGet,controllerOwners,[controller]) as WorkflowControllerOwner|undefined:undefined;if(!owner?.io)throw Error('WORKFLOW_CONTROLLER_PHYSICAL_UNCONFIRMED');
 const children=readOriginalWorkflowScriptChildrenPhysicalFate(owner.service,controller);
 return {async waitKnown(){await owner.io!.waitPhysicalKnown();await children.waitKnown();},assertKnown(){owner.io!.assertPhysicalKnown();children.assertKnown();}};
}
export function completeOriginalWorkflowScriptController(controller:WorkflowScriptController,result:unknown,terminal:WorkflowScriptTerminalResult|null,beforeEffects?:()=>void):Promise<{workflowRun:Record<string,unknown>}>{const owner=ownerApply(ownerGet,controllerOwners,[controller]) as WorkflowControllerOwner|undefined;if(!owner)throw Error('WORKFLOW_ROOT_CONTROLLER_REQUIRED');return completeWorkflowScriptWithOwner({kswarmService:owner.service,projectId:owner.projectId,workflowRunId:owner.workflowRunId,result,terminal,beforeEffects},owner);}
/** Passive original controller ownership; public construction alone grants no Root. */
export function readOriginalKSwarmWorkflowController(controller:unknown,service:unknown):Readonly<{projectId:string;workflowRunId:string}>{if(!controller||typeof controller!=='object'||types.isProxy(controller))throw Error('WORKFLOW_ROOT_CONTROLLER_REQUIRED');const row=ownerApply(ownerGet,controllerOwners,[controller]) as WorkflowControllerOwner|undefined;if(!row||row.service!==service)throw Error('WORKFLOW_ROOT_CONTROLLER_REQUIRED');return Object.freeze({projectId:row.projectId,workflowRunId:row.workflowRunId});}
const knownTerminalFailures=new WeakMap<object,{owner:WorkflowControllerOwner;nodeId:string;status:string}>();
/** Business terminal observation only; never a physical close or Native grant. */
export function isKSwarmWorkflowKnownTerminalFailure(controller:WorkflowScriptController,error:unknown):boolean{
  if(error===null||(typeof error!=='object'&&typeof error!=='function'))return false;
  const known=knownTerminalFailures.get(error),owner=controllerOwners.get(controller);
  return Boolean(known&&owner&&known.owner===owner);
}

export type KSwarmScriptAcknowledgedEffect =
  | Readonly<{ kind: 'proposal'; projectId: string; proposalId: string }>
  | Readonly<{ kind: 'run'; projectId: string; workflowRunId: string }>;

export interface KSwarmScriptWorkflowRunInput {
  /** Record a parsed, scope-checked ACK before checking admission for the next effect. */
  onAcknowledged?: (effect: KSwarmScriptAcknowledgedEffect, snapshot: Record<string, unknown>) => void;
  beforeEffects?:()=>void;
  kswarmService: KSwarmService;
  projectId: string;
  preview: unknown;
  requestedBy?: string;
  scriptSource?: string | null;
  scriptHash?: string | null;
}

export interface KSwarmScriptWorkflowRunResult {
  workflowProposal: Record<string, unknown>;
  workflowRun: Record<string, unknown>;
}

export interface KSwarmWorkflowScriptControllerOptions {
  beforeEffects?:()=>void;
  kswarmService: KSwarmService;
  projectId: string;
  workflowRunId: string;
  assignedAgent?: string | null;
  pollIntervalMs?: number;
  timeoutMs?: number;
  reuseCompletedPrimitives?: boolean;
}

export async function createKSwarmScriptWorkflowRun({
  kswarmService,
  projectId,
  preview,
  requestedBy = 'human',
  scriptSource = null,
  scriptHash = null,beforeEffects,onAcknowledged,
}: KSwarmScriptWorkflowRunInput): Promise<KSwarmScriptWorkflowRunResult> {
  const proposal = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/script-generated/proposal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ preview, requestedBy, scriptSource, scriptHash }),
  },beforeEffects);
  const workflowProposal = readRecord(readRecord(proposal).workflowProposal);
  const proposalId = readString(workflowProposal.id);
  if (!proposalId) throw workflowScriptKSwarmError('workflow_script_proposal_missing', 'KSwarm did not return a workflow proposal id');
  if (workflowProposal.projectId !== projectId) throw workflowScriptKSwarmError('workflow_script_scope_mismatch', 'KSwarm returned a proposal outside the requested project');
  onAcknowledged?.(Object.freeze({kind:'proposal',projectId,proposalId}),workflowProposal);

  const started = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/script-generated/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ proposalId, approvedBy: requestedBy }),
  },beforeEffects);
  const workflowRun = readRecord(readRecord(started).workflowRun);
  if (!readString(workflowRun.id)) throw workflowScriptKSwarmError('workflow_script_run_missing', 'KSwarm did not return a workflow run id');
  assertWorkflowRunScope(workflowRun,projectId,readString(workflowRun.id));
  onAcknowledged?.(Object.freeze({kind:'run',projectId,workflowRunId:readString(workflowRun.id)}),workflowRun);
  return { workflowProposal, workflowRun };
}

export function completeKSwarmScriptWorkflowRun(input:Parameters<typeof completeWorkflowScriptWithOwner>[0]):Promise<{workflowRun:Record<string,unknown>}>{return completeWorkflowScriptWithOwner(input);}

async function completeWorkflowScriptWithOwner({
  kswarmService,
  projectId,
  workflowRunId,
  result,
  terminal = null,beforeEffects,
}: {
  kswarmService: KSwarmService;
  projectId: string;
  workflowRunId: string;
  result: unknown;
  terminal?: WorkflowScriptTerminalResult | null;
  beforeEffects?:()=>void;
},originalScope?:WorkflowControllerOwner): Promise<{ workflowRun: Record<string, unknown> }> {
  const completed = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowRunId)}/script/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ result, terminal }),
  },beforeEffects,originalScope,true);
  const workflowRun = readRecord(readRecord(completed).workflowRun);
  if (!readString(workflowRun.id)) throw workflowScriptKSwarmError('workflow_script_completion_missing', 'KSwarm did not return a completed workflow run');
  assertWorkflowRunScope(workflowRun,projectId,workflowRunId);
  return { workflowRun };
}

function workflowNodeBody(input:WorkflowScriptAgentInput,assignedAgent:string|null){return {
          nodeId: input.nodeId,
          attemptId: input.attemptId,
          phaseTitle: input.phaseTitle || '动态执行',
          label: input.label,
          prompt: input.prompt,
          assignedAgent,
          options: input.options,
          parallelGroupId: input.parallelGroupId,
          fanoutItemKey: input.fanoutItemKey,
          fanoutItemLabel: input.fanoutItemLabel,
          pipelineStageIndex: input.pipelineStageIndex,
          required: input.required,
          outputSchema: input.outputSchema,
          evidenceRequired: input.evidenceRequired,
          modelCapability: input.modelCapability,
          role: input.role,
          trustLevel: input.trustLevel,
          inputRefs: input.inputRefs,
          sourceRefs: input.sourceRefs,
          permissions: input.permissions,
          stableKey: input.stableKey,
        };}

export function createKSwarmWorkflowScriptController({
  kswarmService,
  projectId,
  workflowRunId,
  assignedAgent = null,
  pollIntervalMs = 1_000,
  timeoutMs = 10 * 60_000,
  reuseCompletedPrimitives = false,beforeEffects,
}: KSwarmWorkflowScriptControllerOptions): WorkflowScriptController {
  const scope:WorkflowControllerOwner={service:kswarmService,projectId,workflowRunId,childBytes:0},originalBeforeEffects=beforeEffects;
  scope.io=originalWorkflowIo(kswarmService,projectId,workflowRunId);
  beforeEffects=()=>{assertBeforeEffects(originalBeforeEffects);if(scope.runtime)readOriginalWorkflowScriptRuntimeFate(controller,scope.runtime).assertOpen();};
  scope.guard=beforeEffects;
  const controller:WorkflowScriptController={
    async emitPhase(_input: WorkflowScriptPhaseInput): Promise<void> {
      // KSwarm materializes phases when dynamic nodes are created. Phase-only
      // events remain local to avoid empty durable phases during exploratory scripts.
    },
    async emitLog(_input: WorkflowScriptLogInput): Promise<void> {
      // Reserved for workflow progress batching; current MVP keeps logs local.
    },
    async beginParallelGroup(input: WorkflowScriptParallelGroupInput): Promise<{ parallelGroupId: string }> {
      if (reuseCompletedPrimitives) {
        const existingGroupId = await findReusableParallelGroupId({
          kswarmService,
          projectId,
          workflowRunId,
          input,originalScope:scope,
        });
        if (existingGroupId) return { parallelGroupId: existingGroupId };
      }

      const created = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowRunId)}/script/parallel-groups`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          phaseTitle: input.phaseTitle || '动态执行',
          label: input.label,
          primitiveId: input.primitiveId,
          kind: input.kind,
          totalCount: input.totalCount,
          limit: input.limit,
          failurePolicy: input.failurePolicy,
          quorum: input.quorum,
        }),
      },beforeEffects,scope);
      const parallelGroupId = readString(readRecord(readRecord(created).parallelGroup).id);
      if (!parallelGroupId) throw workflowScriptKSwarmError('workflow_script_parallel_group_missing', 'KSwarm did not return a workflow parallel group id');
      return { parallelGroupId };
    },
    async reserveBudget(input: { runId: string; nodeId: string; tokens: number }): Promise<{ reserved: boolean; attemptId: string }> {
      const reserved = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(input.runId)}/budget/reserve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodeId: input.nodeId, tokens: input.tokens }),
      },beforeEffects,scope);
      const body = readRecord(reserved);
      return {
        reserved: body.reserved === true,
        attemptId: readString(body.attemptId),
      };
    },
    async consumeBudget(input: { runId: string; nodeId: string; attemptId: string; reserved: number; actual: number; usageSource: 'provider' | 'estimate' }): Promise<void> {
      await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(input.runId)}/budget/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'budget_consumed',
          nodeId: input.nodeId,
          attemptId: input.attemptId,
          reserved: input.reserved,
          actual: input.actual,
          usageSource: input.usageSource,
        }),
      },undefined,scope,true);
    },
    async releaseBudget(input: { runId: string; nodeId: string; attemptId: string; tokens: number }): Promise<void> {
      await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(input.runId)}/budget/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'budget_released',
          nodeId: input.nodeId,
          attemptId: input.attemptId,
          tokens: input.tokens,
        }),
      },undefined,scope,true);
    },
    async checkRemainingBudget(runId: string): Promise<number> {
      const remaining = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(runId)}/budget/remaining`,undefined,undefined,scope);
      return Math.max(0, Number(readRecord(readRecord(remaining).budget).remaining || 0));
    },
    async verifyEvidence(input): Promise<{ ok: boolean; failures: string[]; warnings: string[] }> {
      const verified = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(input.runId)}/nodes/${encodeURIComponent(input.nodeId)}/verify-evidence`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          result: input.result,
          workspaceRoot: input.workspaceRoot,
          checks: input.checks,
        }),
      },beforeEffects,scope);
      const verdict = readRecord(readRecord(verified).verdict);
      return {
        ok: verdict.ok === true,
        failures: readStringArray(verdict.failures),
        warnings: readStringArray(verdict.warnings),
      };
    },
    async markNodeIntervention(input: { runId: string; nodeId: string; failures: string[] }): Promise<void> {
      await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(input.runId)}/nodes/${encodeURIComponent(input.nodeId)}/action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'needs_manual_intervention', failures: input.failures }),
      },beforeEffects,scope);
    },
    async markBranchSkipped(input: { runId: string; nodeId: string; label: string }): Promise<void> {
      await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(input.runId)}/nodes/${encodeURIComponent(input.nodeId)}/action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'skip', label: input.label, reason: 'budget_skipped' }),
      },beforeEffects,scope);
    },
    async createAgentNode(input: WorkflowScriptAgentInput): Promise<unknown> {
      if (reuseCompletedPrimitives && input.nodeId && !input.forceRetry) {
        const reusableById = await findReusableAgentNodeById({
          kswarmService,
          projectId,
          workflowRunId,
          input,originalScope:scope,
        });
        if (reusableById.found) return reusableById.output;
      }
      if (reuseCompletedPrimitives && !input.forceRetry) {
        const reusable = await findReusableAgentNode({
          kswarmService,
          projectId,
          workflowRunId,
          input,originalScope:scope,
        });
        if (reusable.found) return reusable.output;
        if (reusable.retryableNodeId) {
          const child=registerOriginalChild(controller,scope,{operation:'retry_node',body:workflowNodeBody(input,assignedAgent),providerNodeId:reusable.retryableNodeId});let retried:unknown;
          try{
          retried = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowRunId)}/script/nodes/${encodeURIComponent(reusable.retryableNodeId)}/retry`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ assignedAgent }),
          },beforeEffects,scope);
          }catch(raw){child?.reject(raw);throw raw;}
          const nodeId = readString(readRecord(retried).nodeId);
          confirmOriginalChild(child,nodeId,retried);
          if(!nodeId)throw workflowScriptKSwarmError('workflow_script_node_missing','KSwarm did not return the retried node receipt');
          return waitForWorkflowNodeOutput({
            kswarmService,
            projectId,
            workflowRunId,
            nodeId,
            pollIntervalMs,
            timeoutMs,knownTerminalScope:scope,
          });
        }
      }

      const nodeBody=workflowNodeBody(input,assignedAgent),child=registerOriginalChild(controller,scope,{operation:'create_node',body:nodeBody});let created:unknown;
      try{
      created = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowRunId)}/script/nodes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(nodeBody),
      },beforeEffects,scope);
      }catch(raw){child?.reject(raw);throw raw;}
      const nodeId = readString(readRecord(created).nodeId);
      confirmOriginalChild(child,nodeId,created);
      if (!nodeId) throw workflowScriptKSwarmError('workflow_script_node_missing', 'KSwarm did not return a workflow node id');
      return waitForWorkflowNodeOutput({
        kswarmService,
        projectId,
        workflowRunId,
        nodeId,
        pollIntervalMs,
        timeoutMs,knownTerminalScope:scope,
      });
    },
  };
  controllerOwners.set(controller,scope);return controller;
}

async function findReusableParallelGroupId({
  kswarmService,
  projectId,
  workflowRunId,
  input,originalScope,
}: {
  kswarmService: KSwarmService;
  projectId: string;
  workflowRunId: string;
  input: WorkflowScriptParallelGroupInput;
  originalScope?:WorkflowControllerOwner;
}): Promise<string | null> {
  const workflowRun = await fetchWorkflowRunSnapshot({ kswarmService, projectId, workflowRunId,originalScope });
  const groups = Array.isArray(workflowRun.parallelGroups) ? workflowRun.parallelGroups.filter(isRecord) : [];
  const match = groups.find(group => {
    const status = readString(group.status);
    const persistedTotalCount = Number(group.totalCount || 0);
    return readString(group.primitiveId) === input.primitiveId
      && readString(group.kind) === input.kind
      && readString(group.label) === input.label
      && persistedTotalCount >= input.totalCount
      && status !== 'cancelled';
  });
  return readString(match?.id) || null;
}

async function findReusableAgentNode({
  kswarmService,
  projectId,
  workflowRunId,
  input,originalScope,
}: {
  kswarmService: KSwarmService;
  projectId: string;
  workflowRunId: string;
  input: WorkflowScriptAgentInput;
  originalScope?:WorkflowControllerOwner;
}): Promise<{ found: boolean; output: unknown; retryableNodeId: string | null }> {
  const workflowRun = await fetchWorkflowRunSnapshot({ kswarmService, projectId, workflowRunId,originalScope });
  const nodes = Array.isArray(workflowRun.nodes) ? workflowRun.nodes.filter(isRecord) : [];
  const match = nodes.find(node => {
    if (!workflowScriptNodeMatchesInput(node, input)) return false;
    return readString(node.status) === 'completed';
  });
  if (match) return { found: true, output: match.output ?? null, retryableNodeId: null };
  const retryable = nodes.find(node => {
    if (!workflowScriptNodeMatchesInput(node, input)) return false;
    return ['blocked', 'failed'].includes(readString(node.status));
  });
  return { found: false, output: null, retryableNodeId: readString(retryable?.id) || null };
}

async function findReusableAgentNodeById({
  kswarmService,
  projectId,
  workflowRunId,
  input,originalScope,
}: {
  kswarmService: KSwarmService;
  projectId: string;
  workflowRunId: string;
  input: WorkflowScriptAgentInput;
  originalScope?:WorkflowControllerOwner;
}): Promise<{ found: boolean; output: unknown }> {
  const workflowRun=await fetchWorkflowRunSnapshot({kswarmService,projectId,workflowRunId,originalScope});
  const node=readRecord((workflowRun.nodes as unknown[]).find(item=>isRecord(item)&&item.id===input.nodeId));
  if (!workflowScriptNodeMatchesInput(node, input)) return { found: false, output: null };
  if (readString(node.status) !== 'completed') return { found: false, output: null };
  return {
    found: true,
    output: node.result ?? node.output ?? null,
  };
}

function workflowScriptNodeMatchesInput(node: Record<string, unknown>, input: WorkflowScriptAgentInput): boolean {
    const nodeInput = readRecord(node.input);
    const script = readRecord(nodeInput.script);
    return readString(node.kind) === 'agent_task'
      && readString(nodeInput.prompt) === input.prompt
      && readString(nodeInput.label) === input.label
      && (input.phaseTitle == null || readString(script.phaseTitle) === input.phaseTitle)
      && nullableString(node.parallelGroupId) === nullableString(input.parallelGroupId)
      && nullableString(node.fanoutItemKey) === nullableString(input.fanoutItemKey)
      && nullableString(node.fanoutItemLabel) === nullableString(input.fanoutItemLabel)
      && workflowScriptPipelineStageMatches(node, input)
      && stableJson(nodeInput.options ?? null) === stableJson(input.options || null);
}

function workflowScriptPipelineStageMatches(node: Record<string, unknown>, input: WorkflowScriptAgentInput): boolean {
  const nodeStage = nullableNumber(node.pipelineStageIndex);
  const inputStage = nullableNumber(input.pipelineStageIndex);
  if (inputStage === null && nodeStage === 0) return true;
  return nodeStage === inputStage;
}

async function fetchWorkflowRunSnapshot({
  kswarmService,
  projectId,
  workflowRunId,originalScope,
}: {
  kswarmService: KSwarmService;
  projectId: string;
  workflowRunId: string;
  originalScope?:WorkflowControllerOwner;
}): Promise<Record<string, unknown>> {
  const detail = await requestKSwarmJson(kswarmService, `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowRunId)}`,undefined,undefined,originalScope);
  const run=readRecord(readRecord(detail).workflowRun);assertWorkflowRunScope(run,projectId,workflowRunId);
  if(!Array.isArray(run.nodes))throw workflowScriptKSwarmError('workflow_script_run_snapshot_invalid','Workflow snapshot has no original node list');
  return run;
}

async function waitForWorkflowNodeOutput({
  kswarmService,
  projectId,
  workflowRunId,
  nodeId,
  pollIntervalMs,
  timeoutMs,knownTerminalScope,
}: {
  kswarmService: KSwarmService;
  projectId: string;
  workflowRunId: string;
  nodeId: string;
  pollIntervalMs: number;
  timeoutMs: number;
  knownTerminalScope?:WorkflowControllerOwner;
}): Promise<unknown> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const workflowRun=await fetchWorkflowRunSnapshot({kswarmService,projectId,workflowRunId,originalScope:knownTerminalScope});
    const node = readWorkflowNode(workflowRun, nodeId);
    const status = readString(node.status);
    if (status === 'completed') return node.output ?? null;
    if (['failed', 'blocked', 'cancelled'].includes(status)) {
      const error=workflowScriptKSwarmError('workflow_script_node_terminal', `workflow node ${nodeId} ended with status ${status}`, { nodeId, status });
      if(knownTerminalScope&&knownTerminalScope.service===kswarmService&&knownTerminalScope.projectId===projectId&&knownTerminalScope.workflowRunId===workflowRunId&&workflowRun.id===workflowRunId&&workflowRun.projectId===projectId&&node.id===nodeId)knownTerminalFailures.set(error,{owner:knownTerminalScope,nodeId,status});
      throw error;
    }
    await sleep(pollIntervalMs);
  }
  throw workflowScriptKSwarmError('workflow_script_node_timeout', `workflow node ${nodeId} did not complete before timeout`, { nodeId });
}

function originalWorkflowIo(service:KSwarmService,projectId:string,runId:string|null):OriginalKSwarmWorkflowControllerIO|undefined{try{return readOriginalKSwarmWorkflowControllerIO(service,projectId,runId);}catch(raw){if(raw instanceof Error&&Object.getOwnPropertyDescriptor(raw,'message')?.value==='KSWARM_ORIGINAL_SERVICE_REQUIRED'&&readCurrentOriginalRootExecutionContext()===null)return;throw raw;}}
async function requestKSwarmJson(kswarmService: KSwarmService, path: string, init?: RequestInit,beforeEffects?:()=>void,scope?:WorkflowControllerOwner,settlement=false): Promise<unknown> {
  if (!kswarmService) throw workflowScriptKSwarmError('kswarm_service_missing', 'KSwarm service is missing');
  const originalBefore=beforeEffects;if(scope?.guard&&!settlement)beforeEffects=()=>{scope.guard!();assertBeforeEffects(originalBefore);};
  const parts=path.split('/'),projectId=scope?.projectId??decodeURIComponent(parts[2]??''),runId=scope?.workflowRunId??(parts[4]==='script-generated'?null:decodeURIComponent(parts[4]??'')),io=scope?.io??originalWorkflowIo(kswarmService,projectId,runId);
  if(io){const result=await io.perform(workflowControllerOperationForRoute(projectId,runId,path,init),beforeEffects);if(!result.ok)throw workflowScriptKSwarmError('kswarm_http_'+result.status,'KSwarm request failed');const body=result.body;if(isRecord(body)&&body.ok===false)throw workflowScriptKSwarmError(readString(body.error)||'kswarm_request_failed',readString(body.error)||'kswarm_request_failed');return body;}
  const headers = new Headers(init?.headers);
  if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
    const token = kswarmService.getDesktopMutationToken?.();
    if (token) headers.set('x-kswarm-mutation-token', token);
  }
  assertBeforeEffects(beforeEffects);
  const response = await kswarmService.request(path, { ...init, headers },beforeEffects);
  const body:unknown=await response.json();
  if (!response.ok) {
    throw workflowScriptKSwarmError(`kswarm_http_${response.status}`, `KSwarm request failed with HTTP ${response.status}`);
  }
  if (isRecord(body) && body.ok === false) {
    throw workflowScriptKSwarmError(readString(body.error) || 'kswarm_request_failed', readString(body.error) || 'KSwarm request failed');
  }
  return body;
}

function readWorkflowNode(workflowRun: Record<string, unknown>, nodeId: string): Record<string, unknown> {
  const nodes = Array.isArray(workflowRun.nodes) ? workflowRun.nodes : [];
  const node = nodes.find(item => isRecord(item) && item.id === nodeId);
  if (!isRecord(node)) throw workflowScriptKSwarmError('workflow_script_node_not_found', `workflow node ${nodeId} was not found`, { nodeId });
  return node;
}

function assertWorkflowRunScope(run:Record<string,unknown>,projectId:string,workflowRunId:string):void{
  if(run.id!==workflowRunId||run.projectId!==projectId)throw workflowScriptKSwarmError('workflow_script_run_scope_mismatch','Workflow response does not match the original project and run');
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(readString).filter(Boolean) : [];
}

function nullableString(value: unknown): string | null {
  const text = readString(value);
  return text || null;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value ?? null));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value ?? null;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, stableValue(value[key])]),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function workflowScriptKSwarmError(code: string, message: string, details: Record<string, unknown> = {}): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  Object.assign(error, details);
  return error;
}
