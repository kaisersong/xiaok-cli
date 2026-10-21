import { captureIntentData } from './data.js';
import {createLogger} from '../../utils/logger.js';
const log=createLogger('skill-eval-sync');
import type { RuntimeHooks } from '../hooks.js';
import type {StoredSessionIntentLedgerInput,StoredIntentRecordInput,StoredStageInput,StoredStepInput} from './stored-intent-clone.js';
import type {SkillRoutingObservation} from './skill-eval.js';
import { SessionIntentDelegationStore } from './store.js';
import { SessionSkillEvalStore } from './skill-eval-store.js';
import { FileSkillScoreStore } from './skill-score-store.js';

export interface SkillEvalRuntimeSyncOptions {
  hooks: RuntimeHooks;
  ledgerStore: SessionIntentDelegationStore;
  skillEvalStore: SessionSkillEvalStore;
  scoreStore: FileSkillScoreStore;
  sessionId: string;
  onError?: (error:unknown)=>void;
}

export function wireSkillEvalToRuntimeSync(options: SkillEvalRuntimeSyncOptions): () => Promise<void> {
  let open=true,tail:Promise<void>=Promise.resolve();
  const errors: unknown[] = [];
  let stopping: Promise<void> | undefined;
  const report=(error:unknown)=>{errors.push(error);try{if(options.onError)void Promise.resolve(options.onError(error)).catch(()=>{});else log.warn('skill_eval_sync_failed',{error:String(error)});}catch{/* Diagnostics cannot detach another rejection. */}};
  const enqueue=(work:()=>Promise<unknown>)=>{if(!open)return;const pending=tail.then(()=>options.skillEvalStore.withMutation(options.sessionId,work));tail=pending.then(()=>{},report);};
  const refreshLedger=()=>options.ledgerStore.load(options.sessionId);
  enqueue(()=>refreshLedger());

  const unsubscribers = [
    options.hooks.on('intent_created', (rawEvent) => {
      if (!open) return;
      let event: typeof rawEvent;
      try { event=captureIntentData(rawEvent); } catch(error) { report(error); return; }
      if (event.sessionId !== options.sessionId) {
        return;
      }
      enqueue(async()=>{const ledger=await refreshLedger();
        const intent = findSkillIntent(ledger,event.intentId);
        if (!intent) {
          return;
        }
        await options.skillEvalStore.ensureObservationsForIntent(options.sessionId, intent);
      });
    }),
    options.hooks.on('tool_started', (rawEvent) => {
      if (!open) return;
      let event: typeof rawEvent;
      try { event=captureIntentData(rawEvent); } catch(error) { report(error); return; }
      if (event.sessionId !== options.sessionId || event.toolName !== 'skill') {
        return;
      }
      const skillName = typeof event.toolInput.name === 'string' ? event.toolInput.name.trim() : '';
      if (!skillName) {
        return;
      }
      enqueue(async()=>{const ledger=await refreshLedger();
        const activeIntent = resolveActiveIntent(ledger);
        if (!activeIntent) {
          return;
        }
        assertSkillStepId(activeIntent.activeStepId);
        await options.skillEvalStore.recordSkillInvocation(options.sessionId, {
          intentId: activeIntent.intentId,
          stepId: activeIntent.activeStepId,
          skillName,
          intent: activeIntent,
        });
      });
    }),
    options.hooks.on('step_activated', (rawEvent) => {
      if (!open) return;
      let event: typeof rawEvent;
      try { event=captureIntentData(rawEvent); } catch(error) { report(error); return; }
      if (event.sessionId !== options.sessionId) {
        return;
      }
      enqueue(async()=>{const ledger=await refreshLedger(),step=findSkillStep(ledger,event.intentId,event.stepId);if(!step||step.status==='skipped')return;
        assertObservationStatus(step.status);
        await options.skillEvalStore.updateObservationStatus(options.sessionId,{intentId:event.intentId,stepId:event.stepId,status:step.status});
      });
    }),
    options.hooks.on('breadcrumb_emitted', (rawEvent) => {
      if (!open) return;
      let event: typeof rawEvent;
      try { event=captureIntentData(rawEvent); } catch(error) { report(error); return; }
      if(event.sessionId!==options.sessionId)return;
      enqueue(async()=>{const ledger=await refreshLedger(),step=findSkillStep(ledger,event.intentId,event.stepId);if(!step||step.status==='skipped')return;
        assertObservationStatus(step.status);
        const state=await options.skillEvalStore.updateObservationStatus(options.sessionId,{intentId:event.intentId,stepId:event.stepId,status:step.status});
        if(step.status!=='completed'&&step.status!=='failed')return;
        const observation=state.observations.find(candidate=>candidate.intentId===event.intentId&&candidate.stepId===event.stepId);if(!observation)return;
        options.skillEvalStore.assertMutationCurrent(options.sessionId);options.scoreStore.recordRuntimeObservation(observation);
      });
    }),
    options.hooks.on('artifact_recorded', (rawEvent) => {
      if (!open) return;
      let event: typeof rawEvent;
      try { event=captureIntentData(rawEvent); } catch(error) { report(error); return; }
      if (event.sessionId !== options.sessionId) {
        return;
      }
      enqueue(async()=>{const ledger=await refreshLedger();
        const intent = findSkillIntent(ledger,event.intentId);
        const artifact = findSkillArtifact(intent,event.artifactId);
        if (!intent || !artifact) {
          return;
        }
        assertArtifactValidationData(artifact);
        await options.skillEvalStore.recordArtifact(options.sessionId, {
          intentId: event.intentId,
          stageId: event.stageId,
          structuralValidation: artifact.structuralValidation,
          semanticValidation: artifact.semanticValidation,
        });
      });
    }),
  ];

  return () => {
    if (stopping) return stopping;
    open=false;
    // Publish before unsubscribe/diagnostic callbacks can reenter stop. The
    // serial tail still runs all previously accepted mutations after failures.
    stopping = Promise.resolve().then(async () => {
      await tail;
      if (errors.length) throw new AggregateError([...errors], 'skill evaluation sync shutdown failed');
    });
    for (const unsubscribe of unsubscribers) {
      try { unsubscribe(); } catch (error) { report(error); }
    }
    return stopping;
  };
}

type SkillLedgerData=Pick<StoredSessionIntentLedgerInput,'activeIntentId'|'intents'>;
function skillIntentRows(value:StoredIntentRecordInput[]):StoredIntentRecordInput[]{
  if(!Array.isArray(value))throw Error('skill_eval_intents_data');return value;
}
function skillStageRows(value:StoredStageInput[]|null|undefined):StoredStageInput[]{
  if(!Array.isArray(value))throw Error('skill_eval_stages_data');return value;
}
function skillStepRows(value:StoredStepInput[]):StoredStepInput[]{
  if(!Array.isArray(value))throw Error('skill_eval_steps_data');return value;
}
function isSkillFact(value:unknown):value is Readonly<Record<string,unknown>>{
  return value!==null&&typeof value==='object'&&!Array.isArray(value);
}
function skillFact(value:unknown):Readonly<Record<string,unknown>>{
  if(!isSkillFact(value))throw Error('skill_eval_artifact_data');
  return value;
}
function findSkillIntent(ledger:SkillLedgerData|null|undefined,intentId:string):StoredIntentRecordInput|undefined{
  return ledger===undefined||ledger===null?undefined:skillIntentRows(ledger.intents).find(candidate=>candidate.intentId===intentId);
}
function findSkillStep(ledger:SkillLedgerData|null|undefined,intentId:string,stepId:string):StoredStepInput|undefined{
  const intent=findSkillIntent(ledger,intentId);
  return intent===undefined?undefined:skillStageRows(intent.stages).flatMap(stage=>skillStepRows(stage.steps)).find(step=>step.stepId===stepId);
}
function findSkillArtifact(intent:StoredIntentRecordInput|undefined,artifactId:string):object|undefined{
  const values=intent?.artifacts;
  if(values===undefined||values===null)return undefined;
  if(!Array.isArray(values))throw Error('skill_eval_artifacts_data');
  return values.find(candidate=>skillFact(candidate).artifactId===artifactId);
}
function assertSkillStepId(value:unknown):asserts value is string{
  if(typeof value!=='string')throw Error('skill_eval_step_id_data');
}
function assertObservationStatus(value:unknown):asserts value is SkillRoutingObservation['status']{
  if(value!=='planned'&&value!=='running'&&value!=='blocked'&&value!=='completed'&&value!=='failed')throw Error('skill_eval_status_data');
}
function assertArtifactValidationData(value:object):asserts value is {readonly structuralValidation?:SkillRoutingObservation['structuralValidation'];readonly semanticValidation?:SkillRoutingObservation['semanticValidation']}{
  const data=skillFact(value),structural=data.structuralValidation;
  if(structural!==undefined&&structural!=='pending'&&structural!=='passed'&&structural!=='failed')throw Error('skill_eval_structural_validation_data');
  const semantic=data.semanticValidation;
  if(semantic!==undefined&&semantic!=='pending'&&semantic!=='passed'&&semantic!=='failed')throw Error('skill_eval_semantic_validation_data');
}
function resolveActiveIntent(ledger:SkillLedgerData|null|undefined) {
  if (!ledger?.activeIntentId) {
    return undefined;
  }
  return skillIntentRows(ledger.intents).find((intent) => intent.intentId === ledger.activeIntentId);
}
