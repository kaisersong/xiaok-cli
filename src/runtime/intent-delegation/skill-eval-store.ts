import {AsyncLocalStorage} from 'node:async_hooks';
import type {SessionExecutionLease} from '../../ai/runtime/session-store/execution-authority.js';
import type { SessionStore } from '../../ai/runtime/session-store/store.js';
import type {StoredSessionSnapshot} from '../../ai/runtime/session-store/stored-snapshot-types.js';
import type {StoredIntentRecordInput,StoredStageInput,StoredStepInput} from './stored-intent-clone.js';
import type {
  IntentLedgerRecord,
} from './types.js';
import {
  createEmptySessionSkillEvalState,
  cloneSessionSkillEvalState,
  inferDeliverableFamily,
  type SessionSkillEvalState,
  type SkillFeedbackRecord,
  type SkillRoutingObservation,
} from './skill-eval.js';

type StoredSkillInvocationData={intentId:string;stepId:string;skillName:string;intent?:StoredIntentRecordInput;now?:number};

export class SessionSkillEvalStore {
  private readonly scope=new AsyncLocalStorage<{sessionId:string;lease?:SessionExecutionLease;active:boolean}>();
  private tail:Promise<void>=Promise.resolve();
  private readonly mutationPort?:<T>(sessionId:string,work:(lease?:SessionExecutionLease)=>Promise<T>)=>Promise<T>;
  constructor(private readonly sessionStore: SessionStore,options?:{withMutationLease:<T>(sessionId:string,work:(lease?:SessionExecutionLease)=>Promise<T>)=>Promise<T>}){this.mutationPort=options?.withMutationLease;}
  /** Fixed host composition. No lease or write token is exposed to hook callers. */
  withMutation<T>(sessionId:string,work:()=>Promise<T>):Promise<T>{
    const inherited=this.scope.getStore();if(inherited){this.assertMutationCurrent(sessionId);return Promise.resolve().then(work);}
    const run=async(lease?:SessionExecutionLease)=>{lease?.assertCurrent();const context={sessionId,lease,active:true};try{return await this.scope.run(context,work);}finally{context.active=false;}};
    const pending=this.tail.then(()=>this.mutationPort?this.mutationPort(sessionId,lease=>run(lease)):run());this.tail=pending.then(()=>{},()=>{});return pending;
  }
  assertMutationCurrent(sessionId:string):void{const scope=this.scope.getStore();if(!scope?.active||scope.sessionId!==sessionId)throw Error('skill_eval_mutation_scope');scope.lease?.assertCurrent();}


  async load(sessionId: string): Promise<SessionSkillEvalState | null> {
    const snapshot = await this.sessionStore.load(sessionId);
    if (!snapshot) {
      return null;
    }

    return snapshot.skillEval ? cloneSessionSkillEvalState(snapshot.skillEval) : createEmptySessionSkillEvalState(snapshot.updatedAt);
  }

  ensureObservationsForIntent(sessionId:string,intent:IntentLedgerRecord):Promise<SessionSkillEvalState>;
  ensureObservationsForIntent(sessionId:string,intent:StoredIntentRecordInput):Promise<SessionSkillEvalState>;
  async ensureObservationsForIntent(sessionId:string,intent:StoredIntentRecordInput):Promise<SessionSkillEvalState> {
    return this.mutate(sessionId, (state) => ensureObservationsForIntentState(state, intent));
  }

  recordSkillInvocation(sessionId:string,input:{intentId:string;stepId:string;skillName:string;intent?:IntentLedgerRecord;now?:number}):Promise<SessionSkillEvalState>;
  recordSkillInvocation(sessionId:string,input:StoredSkillInvocationData):Promise<SessionSkillEvalState>;
  async recordSkillInvocation(sessionId:string,input:StoredSkillInvocationData):Promise<SessionSkillEvalState> {
    return this.mutate(sessionId, (state) => {
      const next = cloneSessionSkillEvalState(state);
      const now = input.now ?? Date.now();
      const matchingObservations = next.observations.filter((observation) => (
        observation.intentId === input.intentId && observation.stepId === input.stepId
      ));

      if (matchingObservations.length === 0 && input.intent) {
        const stepContext = findIntentStepContext(input.intent, input.stepId);
        if (stepContext) {
          assertSkillEvalText(stepContext.stage.stageId,'skill_eval_stage_id_data');
          assertSkillEvalText(stepContext.step.stepId,'skill_eval_step_id_data');
          assertSkillEvalIntentType(input.intent.intentType);
          assertSkillEvalRole(stepContext.step.role);
          assertSkillEvalText(stepContext.stage.deliverable,'skill_eval_deliverable_data');
          next.observations.push({
            observationId: `${input.stepId}:skill_eval`,
            sessionId: input.intent.sessionId,
            intentId: input.intent.intentId,
            stageId: stepContext.stage.stageId,
            stepId: stepContext.step.stepId,
            intentType: input.intent.intentType,
            stageRole: stepContext.step.role,
            deliverable: stepContext.stage.deliverable,
            deliverableFamily: inferDeliverableFamily(stepContext.stage.deliverable),
            selectedSkillName: (
              isDedicatedSkillName(stepContext.step.skillName)
                ? stepContext.step.skillName
                : input.skillName
            ),
            actualSkillName: input.skillName,
            status: mapStepStatus(stepContext.step.status),
            artifactRecorded: false,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      for (const observation of next.observations) {
        if (observation.intentId === input.intentId && observation.stepId === input.stepId) {
          observation.actualSkillName = input.skillName;
          observation.updatedAt = now;
        }
      }
      next.updatedAt = now;
      return next;
    });
  }

  async updateObservationStatus(
    sessionId: string,
    input: { intentId: string; stepId: string; status: SkillRoutingObservation['status']; now?: number },
  ): Promise<SessionSkillEvalState> {
    return this.mutate(sessionId, (state) => {
      const next = cloneSessionSkillEvalState(state);
      for (const observation of next.observations) {
        if (observation.intentId === input.intentId && observation.stepId === input.stepId) {
          observation.status = input.status;
          observation.updatedAt = input.now ?? Date.now();
        }
      }
      next.updatedAt = input.now ?? Date.now();
      return next;
    });
  }

  async recordArtifact(
    sessionId: string,
    input: {
      intentId: string;
      stageId: string;
      structuralValidation: SkillRoutingObservation['structuralValidation'];
      semanticValidation: SkillRoutingObservation['semanticValidation'];
      now?: number;
    },
  ): Promise<SessionSkillEvalState> {
    return this.mutate(sessionId, (state) => {
      const next = cloneSessionSkillEvalState(state);
      for (const observation of next.observations) {
        if (observation.intentId === input.intentId && observation.stageId === input.stageId) {
          observation.artifactRecorded = true;
          observation.structuralValidation = input.structuralValidation;
          observation.semanticValidation = input.semanticValidation;
          observation.updatedAt = input.now ?? Date.now();
        }
      }
      next.updatedAt = input.now ?? Date.now();
      return next;
    });
  }

  async markPromptedIntent(sessionId: string, intentId: string, now = Date.now()): Promise<SessionSkillEvalState> {
    return this.mutate(sessionId, (state) => {
      const next = cloneSessionSkillEvalState(state);
      if (!next.promptedIntentIds.includes(intentId)) {
        next.promptedIntentIds.push(intentId);
      }
      next.updatedAt = now;
      return next;
    });
  }

  async recordFeedback(sessionId: string, feedback: SkillFeedbackRecord): Promise<SessionSkillEvalState> {
    return this.mutate(sessionId, (state) => {
      const next = cloneSessionSkillEvalState(state);
      next.feedback.push({
        ...feedback,
        observationIds: [...feedback.observationIds],
      });
      next.updatedAt = feedback.createdAt;
      return next;
    });
  }

  private async mutate(
    sessionId: string,
    apply: (state: SessionSkillEvalState) => SessionSkillEvalState,
  ): Promise<SessionSkillEvalState> {
    return this.withMutation(sessionId,async()=>{
      this.assertMutationCurrent(sessionId);const snapshot=await this.requireSnapshot(sessionId);this.assertMutationCurrent(sessionId);
      const current=snapshot.skillEval?cloneSessionSkillEvalState(snapshot.skillEval):createEmptySessionSkillEvalState(snapshot.updatedAt),next=apply(current);
      const nextSnapshot={...snapshot,updatedAt:Math.max(snapshot.updatedAt,next.updatedAt),skillEval:cloneSessionSkillEvalState(next)},lease=this.scope.getStore()!.lease;
      this.assertMutationCurrent(sessionId);
      if(lease){if(!this.sessionStore.compareAndSave||snapshot.storeRevision===undefined||snapshot.historyDigest===undefined)throw Error('skill_eval_cas_required');await this.sessionStore.compareAndSave({nextSnapshot,expectedStoreRevision:snapshot.storeRevision,expectedHistoryDigest:snapshot.historyDigest,lease});}
      else await this.sessionStore.save(nextSnapshot);
      this.assertMutationCurrent(sessionId);return next;
    });
  }

  private async requireSnapshot(sessionId: string): Promise<StoredSessionSnapshot> {
    const snapshot = await this.sessionStore.load(sessionId);
    if (!snapshot) {
      throw new Error(`session not found: ${sessionId}`);
    }
    return snapshot;
  }
}

export function ensureObservationsForIntentState(state:SessionSkillEvalState,intent:IntentLedgerRecord,now?:number):SessionSkillEvalState;
export function ensureObservationsForIntentState(state:SessionSkillEvalState,intent:StoredIntentRecordInput,now?:number):SessionSkillEvalState;
export function ensureObservationsForIntentState(state:SessionSkillEvalState,intent:StoredIntentRecordInput,now=Date.now()):SessionSkillEvalState {
  const next = cloneSessionSkillEvalState(state);
  for (const stage of skillEvalStages(intent.stages)) {
    for (const step of skillEvalSteps(stage.steps)) {
      if (!isDedicatedSkillName(step.skillName)) {
        continue;
      }
      const existing = next.observations.find((observation) => observation.stepId === step.stepId);
      if (existing) {
        continue;
      }
      assertSkillEvalText(stage.stageId,'skill_eval_stage_id_data');
      assertSkillEvalText(step.stepId,'skill_eval_step_id_data');
      assertSkillEvalIntentType(intent.intentType);
      assertSkillEvalRole(step.role);
      assertSkillEvalText(stage.deliverable,'skill_eval_deliverable_data');
      next.observations.push({
        observationId: `${step.stepId}:skill_eval`,
        sessionId: intent.sessionId,
        intentId: intent.intentId,
        stageId: stage.stageId,
        stepId: step.stepId,
        intentType: intent.intentType,
        stageRole: step.role,
        deliverable: stage.deliverable,
        deliverableFamily: inferDeliverableFamily(stage.deliverable),
        selectedSkillName: step.skillName,
        status: step.status === 'planned' ? 'planned' : mapStepStatus(step.status),
        artifactRecorded: false,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  next.updatedAt = now;
  return next;
}

function skillEvalStages(value:StoredStageInput[]|null|undefined):StoredStageInput[]{
  if(!Array.isArray(value))throw Error('skill_eval_stages_data');return value;
}
function skillEvalSteps(value:StoredStepInput[]):StoredStepInput[]{
  if(!Array.isArray(value))throw Error('skill_eval_steps_data');return value;
}
function assertSkillEvalText(value:unknown,error:string):asserts value is string{
  if(typeof value!=='string')throw Error(error);
}
function assertSkillEvalIntentType(value:unknown):asserts value is SkillRoutingObservation['intentType']{
  if(value!=='generate'&&value!=='revise'&&value!=='summarize'&&value!=='analyze')throw Error('skill_eval_intent_type_data');
}
function assertSkillEvalRole(value:unknown):asserts value is SkillRoutingObservation['stageRole']{
  if(value!=='collect'&&value!=='inspect_current'&&value!=='normalize'&&value!=='identify_delta'&&value!=='extract'&&value!=='compare'&&value!=='compose'&&value!=='rewrite'&&value!=='structure'&&value!=='conclude'&&value!=='validate'&&value!=='finalize')throw Error('skill_eval_role_data');
}
function isDedicatedSkillName(value:unknown):value is string{
  if(!value)return false;
  if(typeof value!=='string')throw Error('skill_eval_skill_name_data');
  return !value.startsWith('generic_llm::');
}
function mapStepStatus(status:unknown):SkillRoutingObservation['status'] {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'blocked') return 'blocked';
  if (status === 'running') return 'running';
  if(status==='planned'||status==='skipped')return 'planned';
  throw Error('skill_eval_status_data');
}

function findIntentStepContext(intent:StoredIntentRecordInput,stepId:string) {
  for (const stage of skillEvalStages(intent.stages)) {
    const step = skillEvalSteps(stage.steps).find((candidate) => candidate.stepId === stepId);
    if (step) {
      return { stage, step };
    }
  }
  return undefined;
}
