import { captureIntentData } from './data.js';
import {createLogger} from '../../utils/logger.js';
const log=createLogger('skill-eval-sync');
import type { RuntimeHooks } from '../hooks.js';
import type { SessionIntentLedger } from './types.js';
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
        const intent = ledger?.intents.find((candidate) => candidate.intentId === event.intentId);
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
      enqueue(async()=>{const ledger=await refreshLedger(),step=ledger?.intents.find(r=>r.intentId===event.intentId)?.stages.flatMap(s=>s.steps).find(s=>s.stepId===event.stepId);if(!step||step.status==='skipped')return;
        await options.skillEvalStore.updateObservationStatus(options.sessionId,{intentId:event.intentId,stepId:event.stepId,status:step.status});
      });
    }),
    options.hooks.on('breadcrumb_emitted', (rawEvent) => {
      if (!open) return;
      let event: typeof rawEvent;
      try { event=captureIntentData(rawEvent); } catch(error) { report(error); return; }
      if(event.sessionId!==options.sessionId)return;
      enqueue(async()=>{const ledger=await refreshLedger(),step=ledger?.intents.find(r=>r.intentId===event.intentId)?.stages.flatMap(s=>s.steps).find(s=>s.stepId===event.stepId);if(!step||step.status==='skipped')return;
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
        const intent = ledger?.intents.find((candidate) => candidate.intentId === event.intentId);
        const artifact = intent?.artifacts?.find((candidate) => candidate.artifactId === event.artifactId);
        if (!intent || !artifact) {
          return;
        }
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

function resolveActiveIntent(ledger: SessionIntentLedger | null | undefined) {
  if (!ledger?.activeIntentId) {
    return undefined;
  }
  return ledger.intents.find((intent) => intent.intentId === ledger.activeIntentId);
}
