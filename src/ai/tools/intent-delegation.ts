import {isDeepStrictEqual} from 'node:util';
import {AsyncLocalStorage} from 'node:async_hooks';
import type {SessionExecutionLease} from '../runtime/session-store/execution-authority.js';
import type {CompoundRegistryExecutionPort} from './index.js';
import type {IntentProducerActionInput} from '../../runtime/intent-delegation/producer-facts.js';
import {captureIntentData} from '../../runtime/intent-delegation/intent-commit-boundary.js';
import type { Tool } from '../../types.js';
import { createIntentPlan } from '../intent-delegation/planner.js';
import { DELEGATION_TEMPLATES } from '../intent-delegation/templates.js';
import type {
  IntentPlanDraft,
  IntentStageDraft,
  IntentType,
  PlannedStep,
  RiskTier,
  StageArtifactRecord,
} from '../intent-delegation/types.js';
import { applyIntentStepUpdate, recordStageArtifact } from '../../runtime/intent-delegation/dispatcher.js';
import { SessionIntentDelegationStore,getIntentProducerMutationPort,isIntentDelegationStoreFor } from '../../runtime/intent-delegation/store.js';
import { assertSessionWriteOwnership } from '../../runtime/intent-delegation/ownership.js';
import type { SessionIntentLedger } from '../../runtime/intent-delegation/types.js';

export interface IntentDelegationToolOptions {
  ledgerStore: SessionIntentDelegationStore;
  sessionId: string;
  instanceId?: string;
  getTurnIntentPlan?: () => IntentPlanDraft | undefined;
}

type ProducerScope={options:IntentDelegationToolOptions;lease:SessionExecutionLease;requestSource:IntentProducerActionInput['requestSource'];providerInvocationId:string;toolInvocationId:string;active:boolean;current():void;bindRegistry(context:Parameters<Tool['execute']>[1]):void};
const producerTools=new WeakMap<Tool,IntentDelegationToolOptions>();
const producerScope=new AsyncLocalStorage<ProducerScope>();
const producerIdentities=new WeakMap<Tool,{execute:Tool['execute'];permission:Tool['permission'];definition:Tool['definition']}>();
function originalProducerTool(tool:Tool):boolean {
 const expected=producerIdentities.get(tool);if(!expected)return false;
 const descriptors=Object.getOwnPropertyDescriptors(tool);
 if(Reflect.ownKeys(tool).some(k=>typeof k!=='string')||Object.keys(descriptors).sort().join(',')!=='definition,execute,permission'||Object.values(descriptors).some(d=>!('value'in d)))return false;
 return descriptors.execute.value===expected.execute&&descriptors.permission.value===expected.permission&&isDeepStrictEqual(captureIntentData(descriptors.definition.value),expected.definition);
}
/** Identity only, never an execution or business grant. */
export function isIntentProducerTool(tool:Tool):boolean{return producerTools.has(tool)&&originalProducerTool(tool);}
/** Read-only identity of the original host-created pair; never inferred from a ledger or tool input. */
export function readProductIntentProducerInstance(tools:readonly Tool[],sessionStore:import('../runtime/session-store/store.js').SessionStore,sessionId:string):string|undefined {
 const pair=tools.filter(tool=>producerTools.has(tool)||['intent_step_update','intent_stage_artifact'].includes(tool.definition.name));
 if(!pair.length)return;
 const origin=producerTools.get(pair[0]);
 if(!origin||pair.length!==2||new Set(pair).size!==2||pair.map(tool=>tool.definition.name).sort().join(',')!=='intent_stage_artifact,intent_step_update'||pair.some(tool=>!originalProducerTool(tool)||producerTools.get(tool)!==origin)||!isIntentDelegationStoreFor(origin.ledgerStore,sessionStore)||origin.sessionId!==sessionId||typeof origin.instanceId!=='string'||!origin.instanceId.trim()||Buffer.byteLength(origin.instanceId)>160||/[\x00-\x1f\x7f]/.test(origin.instanceId))throw Error('intent_producer_fixed_instance');
 return origin.instanceId;
}
/** Fixed product installation bridge; origin and actual Store come from private factory records. */
export function createProductIntentProducerRegistryAdapter(options:{tools:readonly Tool[];sessionStore:import('../runtime/session-store/store.js').SessionStore;sessionId:string;requestSource:'user';assertAdmission():void}) {
 const candidates=options.tools.filter(tool=>producerTools.has(tool)||['intent_step_update','intent_stage_artifact'].includes(tool.definition.name));
 if(!candidates.length)return undefined;
 const origin=producerTools.get(candidates[0]);
 if(options.requestSource!=='user'||!origin||!isIntentDelegationStoreFor(origin.ledgerStore,options.sessionStore))throw Error('intent_producer_product_store');
 return createIntentProducerRegistryAdapter({tools:candidates,ledgerStore:origin.ledgerStore,sessionId:options.sessionId,requestSource:options.requestSource,assertAdmission:options.assertAdmission});
}
export function createIntentProducerRegistryAdapter(options:{tools:readonly Tool[];ledgerStore:SessionIntentDelegationStore;sessionId:string;requestSource:IntentProducerActionInput['requestSource'];assertAdmission():void}) {
  if(!['user','agent','scheduler'].includes(options.requestSource))throw Error('intent_producer_source');
  const store=options.ledgerStore,sessionId=options.sessionId,source=options.requestSource,admit=options.assertAdmission;
  const tools=options.tools.filter(tool=>producerTools.has(tool));
  if(tools.length!==2||tools.some(tool=>!originalProducerTool(tool))||new Set(tools).size!==2||tools.map(tool=>tool.definition.name).sort().join(',')!=='intent_stage_artifact,intent_step_update'||producerTools.get(tools[0])!==producerTools.get(tools[1])||tools.some(tool=>{const origin=producerTools.get(tool)!;return origin.ledgerStore!==store||origin.sessionId!==sessionId;}))throw Error('intent_producer_adapter_identity');
  const instanceId=producerTools.get(tools[0])!.instanceId;
  if(typeof instanceId!=='string'||!instanceId.trim()||Buffer.byteLength(instanceId)>160||/[\x00-\x1f\x7f]/.test(instanceId)||tools.some(tool=>producerTools.get(tool)!.instanceId!==instanceId))throw Error('intent_producer_fixed_instance');
  return {tools:Object.freeze([...tools]),async execute(request:Parameters<CompoundRegistryExecutionPort['execute']>[0],withLease:<T>(callback:(lease:SessionExecutionLease)=>Promise<T>,signal?:AbortSignal,assertAdmission?:()=>void)=>Promise<T>,assertCurrent:()=>void):Promise<string>{
    const context=request.context,origin=request.tool&&producerTools.get(request.tool);
    if(!origin||!tools.includes(request.tool!)||!context?.hostProviderInvocationId||!context.toolInvocationId||context.session.sessionId!==sessionId)throw Error('intent_producer_context');
    const current=()=>{assertCurrent();if(!originalProducerTool(request.tool!))throw Error('intent_producer_adapter_identity');context.signal?.throwIfAborted();const result=admit();if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error('intent_producer_async_admission');}};
    current();
    const prepared=await request.native.prepare(request.name,captureIntentData(request.input),{signal:context.signal});
    current();if(prepared.kind!=='prepared')return prepared.message;
    let registryCurrent:(()=>void)|undefined;
    const nativeCurrent=()=>{current();if(registryCurrent){const result=registryCurrent();if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error('intent_producer_registry_async');}}};
    return withLease(async lease=>{
      nativeCurrent();lease.assertCurrent();const scope:ProducerScope={options:origin,lease,requestSource:source,providerInvocationId:context.hostProviderInvocationId!,toolInvocationId:context.toolInvocationId!,active:true,current:nativeCurrent,bindRegistry(context){
        if(registryCurrent||typeof context?.assertPermissionApproval!=='function')throw Error('intent_producer_registry_guard');
        registryCurrent=context.assertPermissionApproval.bind(context);nativeCurrent();
      }};
      try{return await lease.trackInFlight(producerScope.run(scope,()=>request.native.execute(prepared.invocation)));}finally{scope.active=false;}
    },context.signal,nativeCurrent);
  }};
}
function currentProducerScope(options:IntentDelegationToolOptions):ProducerScope|undefined {
  const scope=producerScope.getStore();if(!scope)return undefined;
  if(!scope.active||scope.options!==options)throw Error('intent_producer_scope_invalid');scope.current();scope.lease.assertCurrent();return scope;
}

export function createIntentDelegationTools(rawOptions: IntentDelegationToolOptions): Tool[] {
  const descriptors=Object.getOwnPropertyDescriptors(rawOptions);
  if(Reflect.ownKeys(rawOptions).some(k=>typeof k!=='string')||Object.values(descriptors).some(d=>!('value'in d)))throw Error('intent_tool_options_accessor');
  const options:IntentDelegationToolOptions=Object.freeze({...rawOptions});
  const recordProducer=getIntentProducerMutationPort(options.ledgerStore);
  const tools:Tool[] = [
    {
      permission: 'safe',
      definition: {
        name: 'intent_create',
        description: '创建当前会话的原生 intent run contract 与有序步骤',
        inputSchema: {
          type: 'object',
          properties: {
            instance_id: { type: 'string' },
            session_id: { type: 'string' },
            raw_intent: { type: 'string' },
            normalized_intent: { type: 'string' },
            intent_type: { type: 'string', enum: ['generate', 'revise', 'summarize', 'analyze'] },
            deliverable: { type: 'string' },
            explicit_constraints: { type: 'array', items: { type: 'string' } },
            delegation_boundary: { type: 'array', items: { type: 'string' } },
            risk_tier: { type: 'string', enum: ['low', 'medium', 'high'] },
            template_id: { type: 'string' },
            continuation_mode: { type: 'string', enum: ['new_intent', 'continue_active', 'clarify'] },
          },
          required: [
            'instance_id',
            'session_id',
            'raw_intent',
            'normalized_intent',
            'intent_type',
            'deliverable',
            'risk_tier',
            'template_id',
          ],
        },
      },
      async execute(input) {
        const sessionId = options.sessionId;
        const instanceId = resolveScopedInstanceId(input.instance_id, options.instanceId);
        const ledger = await loadLedgerOrThrow(options.ledgerStore, sessionId);
        assertSessionWriteOwnership(ledger, instanceId, 'create intent', { allowInitialClaim: true });
        const explicitContinuationMode = requireContinuationMode(input.continuation_mode);
        const turnPlan = resolveTurnIntentPlan(options.getTurnIntentPlan?.(), sessionId);
        const continuationMode = resolveContinuationMode({
          explicitContinuationMode,
          ledger,
          sessionId,
          instanceId,
          rawIntent: requireNonEmptyString(input.raw_intent, 'raw_intent'),
          turnPlan,
        });
        const activeIntent = continuationMode === 'new_intent' ? undefined : requireActiveIntent(ledger, continuationMode);
        const existingIntent = turnPlan
          ? ledger.intents.find((intent) => intent.intentId === turnPlan.intentId)
          : undefined;
        if (existingIntent) {
          return JSON.stringify(existingIntent, null, 2);
        }

        const plan = turnPlan
          ? buildIntentPlanDraftFromPlanner(turnPlan, instanceId, activeIntent?.intentId)
          : buildIntentPlanDraft({
              sessionId,
              instanceId,
              intentId: activeIntent?.intentId,
              rawIntent: requireNonEmptyString(input.raw_intent, 'raw_intent'),
              normalizedIntent: requireNonEmptyString(input.normalized_intent, 'normalized_intent'),
              intentType: requireIntentType(input.intent_type),
              deliverable: requireNonEmptyString(input.deliverable, 'deliverable'),
              explicitConstraints: readStringList(input.explicit_constraints),
              delegationBoundary: readStringList(input.delegation_boundary),
              riskTier: requireRiskTier(input.risk_tier),
              templateId: requireNonEmptyString(input.template_id, 'template_id'),
              continuationMode,
            });

        const next = await options.ledgerStore.appendIntent(sessionId, plan);
        return JSON.stringify(next.latestPlan, null, 2);
      },
    },
    {
      permission: 'safe',
      definition: {
        name: 'intent_step_update',
        description: '更新当前 intent 的 active step 状态，并记录 breadcrumb 或 receipt',
        inputSchema: {
          type: 'object',
          properties: {
            instance_id: { type: 'string' },
            session_id: { type: 'string' },
            intent_id: { type: 'string' },
            active_step_id: { type: 'string' },
            step_status: { type: 'string', enum: ['running', 'blocked', 'completed', 'failed'] },
            breadcrumb: { type: 'string' },
            blocked_reason: { type: 'string' },
            receipt_note: { type: 'string' },
          },
          required: ['instance_id', 'session_id', 'intent_id', 'active_step_id', 'step_status', 'breadcrumb'],
        },
      },
      async execute(input,context) {
        producerScope.getStore()?.bindRegistry(context);
        const sessionId = options.sessionId;
        const intentId = requireNonEmptyString(input.intent_id, 'intent_id');
        const activeStepId = requireNonEmptyString(input.active_step_id, 'active_step_id');
        const stepStatus = requireStepStatus(input.step_status);
        const breadcrumb = requireNonEmptyString(input.breadcrumb, 'breadcrumb');
        const blockedReason = optionalTrimmedString(input.blocked_reason);
        const receiptNote = optionalTrimmedString(input.receipt_note);
        const instanceId = resolveScopedInstanceId(input.instance_id, options.instanceId);

        const ledger = await loadLedgerOrThrow(options.ledgerStore, sessionId);
        assertSessionWriteOwnership(ledger, instanceId, 'update intent step');
        const currentIntent = ledger.intents.find((candidate) => candidate.intentId === intentId);
        if (!currentIntent) {
          return `Error: 未找到 intent ${intentId}`;
        }

        const scope=currentProducerScope(options);
        if(scope){
          const saved=await recordProducer(sessionId,intentId,instanceId,{kind:'step-report',stepId:activeStepId,status:stepStatus,breadcrumb,receiptNote:receiptNote??null,blockedReason:blockedReason??null,origin:{kind:'model-report',providerInvocationId:scope.providerInvocationId,toolInvocationId:scope.toolInvocationId}},scope.requestSource,scope.lease);
          return JSON.stringify(saved.latestPlan,null,2);
        }

        const updatedIntent = applyIntentStepUpdate(currentIntent, {
          stepId: activeStepId,
          status: stepStatus,
        });
        if (blockedReason) {
          updatedIntent.blockedReason = blockedReason;
          updatedIntent.updatedAt = Date.now();
        }

        await options.ledgerStore.saveDispatchedIntent(sessionId, updatedIntent);

        await options.ledgerStore.recordBreadcrumb(sessionId, {
          intentId,
          stepId: activeStepId,
          status: stepStatus,
          message: breadcrumb,
        });

        if (receiptNote) {
          await options.ledgerStore.recordReceipt(sessionId, {
            intentId,
            stepId: activeStepId,
            note: receiptNote,
          });
        }

        if (blockedReason) {
          await options.ledgerStore.updateIntent(sessionId, intentId, {
            blockedReason,
          });
        }

        const saved = await options.ledgerStore.load(sessionId);
        return JSON.stringify(saved?.latestPlan ?? updatedIntent, null, 2);
      },
    },
    {
      permission: 'safe',
      definition: {
        name: 'intent_stage_artifact',
        description: '记录当前 stage 产出的 artifact、其存储引用以及结构/语义校验状态',
        inputSchema: {
          type: 'object',
          properties: {
            instance_id: { type: 'string' },
            session_id: { type: 'string' },
            intent_id: { type: 'string' },
            stage_id: { type: 'string' },
            label: { type: 'string' },
            kind: { type: 'string' },
            storage: { type: 'string', enum: ['inline', 'file_ref'] },
            path: { type: 'string' },
            inline_value: { type: 'string' },
            summary: { type: 'string' },
            structural_validation: { type: 'string', enum: ['pending', 'passed', 'failed'] },
            semantic_validation: { type: 'string', enum: ['pending', 'passed', 'failed'] },
          },
          required: [
            'instance_id',
            'session_id',
            'intent_id',
            'stage_id',
            'label',
            'kind',
            'storage',
            'structural_validation',
            'semantic_validation',
          ],
        },
      },
      async execute(input,context) {
        producerScope.getStore()?.bindRegistry(context);
        const instanceId = resolveScopedInstanceId(input.instance_id, options.instanceId);
        const sessionId = options.sessionId;
        const intentId = requireNonEmptyString(input.intent_id, 'intent_id');
        const stageId = requireNonEmptyString(input.stage_id, 'stage_id');
        const label = requireNonEmptyString(input.label, 'label');

        const ledger = await loadLedgerOrThrow(options.ledgerStore, sessionId);
        assertSessionWriteOwnership(ledger, instanceId, 'record stage artifact');
        const currentIntent = ledger.intents.find((candidate) => candidate.intentId === intentId);
        if (!currentIntent) {
          return `Error: 未找到 intent ${intentId}`;
        }

        const scope=currentProducerScope(options);
        if(scope){
          const text=(value:unknown):string|null=>{if(value===undefined)return null;if(typeof value!=='string')throw Error('intent_producer_text');return value;};
          const saved=await recordProducer(sessionId,intentId,instanceId,{kind:'artifact-report',stageId,kindOfArtifact:requireArtifactKind(input.kind),storage:requireArtifactStorage(input.storage),label,path:text(input.path),inlineValue:text(input.inline_value),summary:text(input.summary),reportedStructuralValidation:requireValidationState(input.structural_validation,'structural_validation'),reportedSemanticValidation:requireValidationState(input.semantic_validation,'semantic_validation'),origin:{kind:'model-report',providerInvocationId:scope.providerInvocationId,toolInvocationId:scope.toolInvocationId}},scope.requestSource,scope.lease);
          return JSON.stringify(saved.latestPlan,null,2);
        }

        const artifact: StageArtifactRecord = {
          artifactId: `${stageId}:artifact:${Date.now().toString(36)}`,
          stageId,
          kind: requireArtifactKind(input.kind),
          storage: requireArtifactStorage(input.storage),
          label,
          path: optionalTrimmedString(input.path),
          inlineValue: optionalTrimmedString(input.inline_value),
          summary: optionalTrimmedString(input.summary),
          structuralValidation: requireValidationState(input.structural_validation, 'structural_validation'),
          semanticValidation: requireValidationState(input.semantic_validation, 'semantic_validation'),
          createdAt: Date.now(),
        };

        const updatedIntent = recordStageArtifact(currentIntent, artifact, artifact.createdAt);
        await options.ledgerStore.saveDispatchedIntent(sessionId, updatedIntent);
        const saved = await options.ledgerStore.load(sessionId);
        return JSON.stringify(saved?.latestPlan ?? updatedIntent, null, 2);
      },
    },
    {
      permission: 'safe',
      definition: {
        name: 'intent_salvage',
        description: '为当前 intent 记录可复用的 salvage value 摘要',
        inputSchema: {
          type: 'object',
          properties: {
            instance_id: { type: 'string' },
            session_id: { type: 'string' },
            intent_id: { type: 'string' },
            summary: { type: 'array', items: { type: 'string' } },
            reason: { type: 'string' },
          },
          required: ['instance_id', 'session_id', 'intent_id', 'summary'],
        },
      },
      async execute(input) {
        const instanceId = resolveScopedInstanceId(input.instance_id, options.instanceId);
        const sessionId = options.sessionId;
        const intentId = requireNonEmptyString(input.intent_id, 'intent_id');
        const summary = readStringList(input.summary);
        if (summary.length === 0) {
          return 'Error: summary 不能为空';
        }

        const ledger = await loadLedgerOrThrow(options.ledgerStore, sessionId);
        assertSessionWriteOwnership(ledger, instanceId, 'record intent salvage');

        const updated = await options.ledgerStore.recordSalvage(sessionId, {
          intentId,
          summary,
          reason: optionalTrimmedString(input.reason),
        });
        return JSON.stringify(updated.latestPlan, null, 2);
      },
    },
  ];
  for(const tool of tools)if(['intent_step_update','intent_stage_artifact'].includes(tool.definition.name)){producerTools.set(tool,options);producerIdentities.set(tool,{execute:tool.execute,permission:tool.permission,definition:captureIntentData(tool.definition)});}
  return tools;
}

function buildIntentPlanDraft(input: {
  sessionId: string;
  instanceId: string;
  intentId?: string;
  rawIntent: string;
  normalizedIntent: string;
  intentType: IntentType;
  deliverable: string;
  explicitConstraints: string[];
  delegationBoundary: string[];
  riskTier: RiskTier;
  templateId: string;
  continuationMode: IntentPlanDraft['continuationMode'];
}): IntentPlanDraft {
  const template = DELEGATION_TEMPLATES.find((candidate) => candidate.id === input.templateId);
  if (!template) {
    throw new Error(`unknown template_id: ${input.templateId}`);
  }
  if (template.intentType !== input.intentType) {
    throw new Error(`template ${input.templateId} does not match intent_type ${input.intentType}`);
  }

  const intentId = input.intentId
    ?? `intent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const stageId = `${intentId}:stage:1`;
  const steps = template.steps.map<PlannedStep>((step, index) => ({
    stepId: `${stageId}:step:${step.key}`,
    key: step.key,
    order: index,
    role: step.role,
    skillName: null,
    dependsOn: index === 0 ? [] : [`${stageId}:step:${template.steps[index - 1]!.key}`],
    status: 'planned',
    riskTier: step.defaultRiskTier ?? input.riskTier,
  }));
  const stages: IntentStageDraft[] = [{
    stageId,
    order: 0,
    label: `生成${input.deliverable}`,
    intentType: input.intentType,
    deliverable: input.deliverable,
    templateId: input.templateId,
    riskTier: input.riskTier,
    dependsOnStageIds: [],
    steps,
  }];

  return {
    instanceId: input.instanceId,
    intentId,
    sessionId: input.sessionId,
    rawIntent: input.rawIntent,
    normalizedIntent: input.normalizedIntent,
    intentType: input.intentType,
    deliverable: input.deliverable,
    finalDeliverable: input.deliverable,
    explicitConstraints: input.explicitConstraints,
    delegationBoundary: input.delegationBoundary,
    riskTier: input.riskTier,
    intentMode: 'single_stage',
    segmentationConfidence: 'low',
    templateId: input.templateId,
    stages,
    steps,
    continuationMode: input.continuationMode,
  };
}

function buildIntentPlanDraftFromPlanner(
  plan: IntentPlanDraft,
  instanceId: string,
  intentId?: string,
): IntentPlanDraft {
  return {
    ...plan,
    instanceId,
    intentId: intentId ?? plan.intentId,
    explicitConstraints: [...plan.explicitConstraints],
    delegationBoundary: [...plan.delegationBoundary],
    stages: plan.stages.map((stage) => ({
      ...stage,
      dependsOnStageIds: [...stage.dependsOnStageIds],
      steps: stage.steps.map((step) => ({
        ...step,
        dependsOn: [...step.dependsOn],
      })),
    })),
    steps: plan.steps.map((step) => ({
      ...step,
      dependsOn: [...step.dependsOn],
    })),
  };
}

async function loadLedgerOrThrow(ledgerStore: SessionIntentDelegationStore, sessionId: string) {
  const ledger = await ledgerStore.load(sessionId);
  if (!ledger) {
    throw new Error(`session not found: ${sessionId}`);
  }
  return ledger;
}

function resolveScopedInstanceId(value: unknown, expected?: string): string {
  if (expected?.trim()) {
    return expected.trim();
  }
  return requireNonEmptyString(value, 'instance_id');
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} 不能为空`);
  }
  return value.trim();
}

function optionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}

function requireIntentType(value: unknown): IntentType {
  const intentType = requireNonEmptyString(value, 'intent_type') as IntentType;
  if (!['generate', 'revise', 'summarize', 'analyze'].includes(intentType)) {
    throw new Error(`非法 intent_type: ${intentType}`);
  }
  return intentType;
}

function requireRiskTier(value: unknown): RiskTier {
  const riskTier = requireNonEmptyString(value, 'risk_tier') as RiskTier;
  if (!['low', 'medium', 'high'].includes(riskTier)) {
    throw new Error(`非法 risk_tier: ${riskTier}`);
  }
  return riskTier;
}

function requireArtifactKind(value: unknown): StageArtifactRecord['kind'] {
  const kind = requireNonEmptyString(value, 'kind') as StageArtifactRecord['kind'];
  if (!['markdown', 'report', 'slides', 'summary', 'analysis', 'document', 'unknown'].includes(kind)) {
    throw new Error(`非法 kind: ${kind}`);
  }
  return kind;
}

function requireArtifactStorage(value: unknown): StageArtifactRecord['storage'] {
  const storage = requireNonEmptyString(value, 'storage') as StageArtifactRecord['storage'];
  if (!['inline', 'file_ref'].includes(storage)) {
    throw new Error(`非法 storage: ${storage}`);
  }
  return storage;
}

function requireValidationState(
  value: unknown,
  field: 'structural_validation' | 'semantic_validation',
): StageArtifactRecord['structuralValidation'] {
  const state = requireNonEmptyString(value, field) as StageArtifactRecord['structuralValidation'];
  if (!['pending', 'passed', 'failed'].includes(state)) {
    throw new Error(`非法 ${field}: ${state}`);
  }
  return state;
}

function requireStepStatus(value: unknown): 'running' | 'blocked' | 'completed' | 'failed' {
  const stepStatus = requireNonEmptyString(value, 'step_status') as 'running' | 'blocked' | 'completed' | 'failed';
  if (!['running', 'blocked', 'completed', 'failed'].includes(stepStatus)) {
    throw new Error(`非法 step_status: ${stepStatus}`);
  }
  return stepStatus;
}

function resolveTurnIntentPlan(
  plan: IntentPlanDraft | undefined,
  sessionId: string,
): IntentPlanDraft | undefined {
  if (!plan || plan.sessionId !== sessionId) {
    return undefined;
  }
  return plan;
}

function resolveContinuationMode(input: {
  explicitContinuationMode?: IntentPlanDraft['continuationMode'];
  ledger: SessionIntentLedger;
  sessionId: string;
  instanceId: string;
  rawIntent: string;
  turnPlan?: IntentPlanDraft;
}): IntentPlanDraft['continuationMode'] {
  if (input.explicitContinuationMode) {
    return input.explicitContinuationMode;
  }

  if (input.turnPlan) {
    return input.turnPlan.continuationMode;
  }

  const activeIntent = resolveActiveIntent(input.ledger);
  const planned = createIntentPlan({
    instanceId: input.instanceId,
    sessionId: input.sessionId,
    input: input.rawIntent,
    skills: [],
    activeIntent: activeIntent
      ? {
          intentId: activeIntent.intentId,
          deliverable: activeIntent.deliverable,
          intentType: activeIntent.intentType,
          templateId: activeIntent.templateId,
        }
      : undefined,
  });

  return planned.kind === 'plan' ? planned.plan.continuationMode : 'new_intent';
}

function resolveActiveIntent(ledger: SessionIntentLedger) {
  if (!ledger.activeIntentId) {
    return undefined;
  }

  return ledger.intents.find((intent) => intent.intentId === ledger.activeIntentId);
}

function requireActiveIntent(
  ledger: SessionIntentLedger,
  continuationMode: IntentPlanDraft['continuationMode'],
) {
  const activeIntent = resolveActiveIntent(ledger);
  if (!activeIntent) {
    throw new Error(`cannot use continuation_mode ${continuationMode}: no active intent is tracked for this session`);
  }
  return activeIntent;
}

function requireContinuationMode(value: unknown): IntentPlanDraft['continuationMode'] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const continuationMode = requireNonEmptyString(value, 'continuation_mode') as IntentPlanDraft['continuationMode'];
  if (!['new_intent', 'continue_active', 'clarify'].includes(continuationMode)) {
    throw new Error(`非法 continuation_mode: ${continuationMode}`);
  }
  return continuationMode;
}
