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
}

export function wireSkillEvalToRuntimeSync(options: SkillEvalRuntimeSyncOptions): () => void {
  let latestLedger: SessionIntentLedger | null | undefined;
  void options.ledgerStore.load(options.sessionId).then((ledger) => {
    latestLedger = ledger;
  });

  const refreshLedger = async (): Promise<SessionIntentLedger | null> => {
    latestLedger = await options.ledgerStore.load(options.sessionId);
    return latestLedger ?? null;
  };

  const unsubscribers = [
    options.hooks.on('intent_created', (event) => {
      if (event.sessionId !== options.sessionId) {
        return;
      }
      void refreshLedger().then(async (ledger) => {
        const intent = ledger?.intents.find((candidate) => candidate.intentId === event.intentId);
        if (!intent) {
          return;
        }
        await options.skillEvalStore.ensureObservationsForIntent(options.sessionId, intent);
      });
    }),
    options.hooks.on('tool_started', (event) => {
      if (event.sessionId !== options.sessionId || event.toolName !== 'skill') {
        return;
      }
      const skillName = typeof event.toolInput.name === 'string' ? event.toolInput.name.trim() : '';
      if (!skillName) {
        return;
      }
      void refreshLedger().then(async (ledger) => {
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
    options.hooks.on('step_activated', (event) => {
      if (event.sessionId !== options.sessionId) {
        return;
      }
      void options.skillEvalStore.updateObservationStatus(options.sessionId, {
        intentId: event.intentId,
        stepId: event.stepId,
        status: 'running',
      });
    }),
    options.hooks.on('breadcrumb_emitted', (event) => {
      if (event.sessionId !== options.sessionId) {
        return;
      }
      void options.skillEvalStore.updateObservationStatus(options.sessionId, {
        intentId: event.intentId,
        stepId: event.stepId,
        status: event.status,
      }).then((state) => {
        if (event.status !== 'completed' && event.status !== 'failed') {
          return;
        }
        const observation = state.observations.find((candidate) => (
          candidate.intentId === event.intentId
          && candidate.stepId === event.stepId
        ));
        if (!observation) {
          return;
        }
        options.scoreStore.recordRuntimeObservation(observation);
      });
    }),
    options.hooks.on('artifact_recorded', (event) => {
      if (event.sessionId !== options.sessionId) {
        return;
      }
      void refreshLedger().then(async (ledger) => {
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
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}

function resolveActiveIntent(ledger: SessionIntentLedger | null | undefined) {
  if (!ledger?.activeIntentId) {
    return undefined;
  }
  return ledger.intents.find((intent) => intent.intentId === ledger.activeIntentId);
}
