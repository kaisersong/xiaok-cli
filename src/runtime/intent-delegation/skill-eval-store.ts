import type { PersistedSessionSnapshot, SessionStore } from '../../ai/runtime/session-store/store.js';
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

export class SessionSkillEvalStore {
  constructor(private readonly sessionStore: SessionStore) {}

  async load(sessionId: string): Promise<SessionSkillEvalState | null> {
    const snapshot = await this.sessionStore.load(sessionId);
    if (!snapshot) {
      return null;
    }

    return snapshot.skillEval ? cloneSessionSkillEvalState(snapshot.skillEval) : createEmptySessionSkillEvalState(snapshot.updatedAt);
  }

  async ensureObservationsForIntent(sessionId: string, intent: IntentLedgerRecord): Promise<SessionSkillEvalState> {
    return this.mutate(sessionId, (state) => ensureObservationsForIntentState(state, intent));
  }

  async recordSkillInvocation(
    sessionId: string,
    input: { intentId: string; stepId: string; skillName: string; intent?: IntentLedgerRecord; now?: number },
  ): Promise<SessionSkillEvalState> {
    return this.mutate(sessionId, (state) => {
      const next = cloneSessionSkillEvalState(state);
      const now = input.now ?? Date.now();
      const matchingObservations = next.observations.filter((observation) => (
        observation.intentId === input.intentId && observation.stepId === input.stepId
      ));

      if (matchingObservations.length === 0 && input.intent) {
        const stepContext = findIntentStepContext(input.intent, input.stepId);
        if (stepContext) {
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
              stepContext.step.skillName && !stepContext.step.skillName.startsWith('generic_llm::')
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
    const snapshot = await this.requireSnapshot(sessionId);
    const current = snapshot.skillEval ? cloneSessionSkillEvalState(snapshot.skillEval) : createEmptySessionSkillEvalState(snapshot.updatedAt);
    const next = apply(current);
    await this.sessionStore.save({
      ...snapshot,
      updatedAt: next.updatedAt,
      skillEval: cloneSessionSkillEvalState(next),
    });
    return next;
  }

  private async requireSnapshot(sessionId: string): Promise<PersistedSessionSnapshot> {
    const snapshot = await this.sessionStore.load(sessionId);
    if (!snapshot) {
      throw new Error(`session not found: ${sessionId}`);
    }
    return snapshot;
  }
}

export function ensureObservationsForIntentState(
  state: SessionSkillEvalState,
  intent: IntentLedgerRecord,
  now = Date.now(),
): SessionSkillEvalState {
  const next = cloneSessionSkillEvalState(state);
  for (const stage of intent.stages) {
    for (const step of stage.steps) {
      if (!step.skillName || step.skillName.startsWith('generic_llm::')) {
        continue;
      }
      const existing = next.observations.find((observation) => observation.stepId === step.stepId);
      if (existing) {
        continue;
      }
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

function mapStepStatus(status: IntentLedgerRecord['steps'][number]['status']): SkillRoutingObservation['status'] {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'blocked') return 'blocked';
  if (status === 'running') return 'running';
  return 'planned';
}

function findIntentStepContext(intent: IntentLedgerRecord, stepId: string) {
  for (const stage of intent.stages) {
    const step = stage.steps.find((candidate) => candidate.stepId === stepId);
    if (step) {
      return { stage, step };
    }
  }
  return undefined;
}
