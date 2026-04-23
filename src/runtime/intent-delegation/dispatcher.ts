import type {
  IntentLedgerRecord,
  IntentStageRecord,
  PlannedStep,
  StageArtifactRecord,
  StepStatus,
} from './types.js';
import { cloneIntentRecord, createIntentLedgerRecord as createIntentLedgerRecordFromPlan } from './types.js';

const ACTIVE_STATUSES = new Set<StepStatus>(['running']);
const TERMINAL_STATUSES = new Set<StepStatus>(['completed', 'failed', 'skipped']);

export function createIntentLedgerRecord(plan: Parameters<typeof createIntentLedgerRecordFromPlan>[0], now?: number): IntentLedgerRecord {
  return createIntentLedgerRecordFromPlan(plan, now);
}

export function activateIntentStep(intent: IntentLedgerRecord, stepId: string, now = Date.now()): IntentLedgerRecord {
  if (stepId !== intent.activeStepId) {
    throw new Error(`step activation out of order: expected activeStepId ${intent.activeStepId}, got ${stepId}`);
  }

  const next = cloneIntentRecord(intent);
  const activeStage = requireActiveStage(next);
  const running = activeStage.steps.find((step) => ACTIVE_STATUSES.has(step.status));
  if (running) {
    throw new Error(`cannot activate step while another step is running: ${running.stepId}`);
  }

  const step = requireStep(activeStage.steps, stepId);
  assertDependenciesCompleted(activeStage.steps, step);

  step.status = 'running';
  activeStage.activeStepId = step.stepId;
  activeStage.status = 'running';
  mirrorStageToIntent(next, activeStage);
  next.overallStatus = 'executing';
  next.updatedAt = now;
  return next;
}

export function applyIntentStepUpdate(
  intent: IntentLedgerRecord,
  input: {
    stepId: string;
    status: Extract<StepStatus, 'running' | 'blocked' | 'completed' | 'failed'>;
    now?: number;
  },
): IntentLedgerRecord {
  if (input.stepId !== intent.activeStepId) {
    throw new Error(`step update rejected for non-active step: activeStepId is ${intent.activeStepId}`);
  }

  const now = input.now ?? Date.now();
  if (input.status === 'running') {
    return activateIntentStep(intent, input.stepId, now);
  }

  const next = cloneIntentRecord(intent);
  const activeStage = requireActiveStage(next);
  const step = requireStep(activeStage.steps, input.stepId);
  const currentRunning = activeStage.steps.find((candidate) => ACTIVE_STATUSES.has(candidate.status));
  if (currentRunning && currentRunning.stepId !== input.stepId) {
    throw new Error(`step update rejected while ${currentRunning.stepId} is running`);
  }

  step.status = input.status;
  next.updatedAt = now;

  if (input.status === 'blocked') {
    activeStage.status = 'waiting_user';
    mirrorStageToIntent(next, activeStage);
    next.overallStatus = 'waiting_user';
    return next;
  }

  if (input.status === 'failed') {
    activeStage.status = 'failed';
    mirrorStageToIntent(next, activeStage);
    next.overallStatus = 'failed';
    return next;
  }

  const nextStep = findNextStep(activeStage.steps, step.stepId);
  if (nextStep) {
    activeStage.activeStepId = nextStep.stepId;
    activeStage.status = 'running';
    mirrorStageToIntent(next, activeStage);
    next.activeStepId = nextStep.stepId;
    next.overallStatus = 'executing';
    return next;
  }

  activeStage.status = 'completed';
  activeStage.structuralValidation = 'passed';
  activeStage.semanticValidation = activeStage.steps.some((candidate) => candidate.key === 'validate') ? 'passed' : 'pending';

  const nextStage = findNextStage(next.stages, activeStage.stageId);
  if (!nextStage) {
    mirrorStageToIntent(next, activeStage);
    next.overallStatus = 'completed';
    return next;
  }

  next.activeStageId = nextStage.stageId;
  nextStage.status = 'planned';
  next.activeStepId = nextStage.activeStepId;
  mirrorStageToIntent(next, nextStage);
  next.overallStatus = 'executing';
  return next;
}

export function recordStageArtifact(
  intent: IntentLedgerRecord,
  artifact: StageArtifactRecord,
  now = Date.now(),
): IntentLedgerRecord {
  const next = cloneIntentRecord(intent);
  const activeStage = next.stages.find((stage) => stage.stageId === artifact.stageId);
  next.artifacts = [...(next.artifacts ?? []), { ...artifact }];
  if (activeStage) {
    activeStage.latestArtifactId = artifact.artifactId;
    activeStage.structuralValidation = artifact.structuralValidation;
    activeStage.semanticValidation = artifact.semanticValidation;
  }
  next.updatedAt = now;
  return next;
}

function requireActiveStage(intent: IntentLedgerRecord): IntentStageRecord {
  const stage = intent.stages.find((candidate) => candidate.stageId === intent.activeStageId);
  if (!stage) {
    throw new Error(`active stage not found: ${intent.activeStageId}`);
  }
  return stage;
}

function requireStep(steps: PlannedStep[], stepId: string): PlannedStep {
  const step = steps.find((candidate) => candidate.stepId === stepId);
  if (!step) {
    throw new Error(`unknown step: ${stepId}`);
  }
  return step;
}

function assertDependenciesCompleted(steps: PlannedStep[], step: PlannedStep): void {
  const missingDependency = step.dependsOn.find((dependencyId) => {
    const dependency = steps.find((candidate) => candidate.stepId === dependencyId);
    return !dependency || dependency.status !== 'completed';
  });

  if (missingDependency) {
    throw new Error(`step activation out of order: dependency not completed ${missingDependency}`);
  }
}

function findNextStep(steps: PlannedStep[], completedStepId: string): PlannedStep | undefined {
  const current = requireStep(steps, completedStepId);
  return [...steps]
    .filter((step) => step.order > current.order && !TERMINAL_STATUSES.has(step.status))
    .sort((left, right) => left.order - right.order)
    .find((step) => step.dependsOn.every((dependencyId) => {
      const dependency = steps.find((candidate) => candidate.stepId === dependencyId);
      return dependency?.status === 'completed';
    }));
}

function findNextStage(stages: IntentStageRecord[], completedStageId: string): IntentStageRecord | undefined {
  const current = stages.find((stage) => stage.stageId === completedStageId);
  if (!current) {
    return undefined;
  }

  return [...stages]
    .filter((stage) => stage.order > current.order && stage.dependsOnStageIds.every((dependencyId) => {
      const dependency = stages.find((candidate) => candidate.stageId === dependencyId);
      return dependency?.status === 'completed';
    }))
    .sort((left, right) => left.order - right.order)[0];
}

function mirrorStageToIntent(intent: IntentLedgerRecord, activeStage: IntentStageRecord): void {
  intent.steps = activeStage.steps.map((step) => ({
    ...step,
    dependsOn: [...step.dependsOn],
  }));
  intent.activeStepId = activeStage.activeStepId;
}
