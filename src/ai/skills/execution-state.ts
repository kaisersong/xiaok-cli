import { createHash } from 'node:crypto';
import type { SkillExecutionPlan } from './planner.js';
import type { SkillComplianceResult } from './compliance.js';

export type SkillInvocationStatus = 'running' | 'completed' | 'incomplete' | 'failed';
export type SkillEvidenceEventType =
  | 'read_reference'
  | 'run_script'
  | 'step_completed'
  | 'success_check_result';

export interface SkillEvidenceEvent {
  type: SkillEvidenceEventType;
  invocationId: string;
  agentId: string;
  createdAt: number;
  path?: string;
  command?: string;
  stepId?: string;
  passed?: boolean;
}

export interface SkillInvocationState {
  invocationId: string;
  sessionId: string;
  agentId: string;
  skillName: string;
  requested: string[];
  strategy: SkillExecutionPlan['strategy'];
  strictMode: boolean;
  bundleHash: string;
  status: SkillInvocationStatus;
  plan: SkillExecutionPlan;
  evidence: SkillEvidenceEvent[];
  compliance?: SkillComplianceResult;
  createdAt: number;
  updatedAt: number;
}

export interface SessionSkillExecutionState {
  invocations: SkillInvocationState[];
  updatedAt: number;
}

export function createEmptySessionSkillExecutionState(now = Date.now()): SessionSkillExecutionState {
  return {
    invocations: [],
    updatedAt: now,
  };
}

export function cloneSessionSkillExecutionState(state: SessionSkillExecutionState): SessionSkillExecutionState {
  return {
    invocations: state.invocations.map(cloneInvocation),
    updatedAt: state.updatedAt,
  };
}

export function activateSkillInvocation(
  state: SessionSkillExecutionState,
  input: {
    sessionId: string;
    agentId: string;
    plan: SkillExecutionPlan;
    requested?: string[];
    now?: number;
  },
): { state: SessionSkillExecutionState; invocation: SkillInvocationState } {
  const next = cloneSessionSkillExecutionState(state);
  const now = input.now ?? Date.now();
  const primarySkill = input.plan.primarySkill;
  const invocation: SkillInvocationState = {
    invocationId: `skill_inv_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    sessionId: input.sessionId,
    agentId: input.agentId,
    skillName: primarySkill,
    requested: [...(input.requested ?? input.plan.requested)],
    strategy: input.plan.strategy,
    strictMode: input.plan.strict,
    bundleHash: hashPlan(input.plan),
    status: 'running',
    plan: cloneSkillExecutionPlan(input.plan),
    evidence: [{
      type: 'step_completed',
      invocationId: '',
      agentId: input.agentId,
      stepId: 'read_skill',
      createdAt: now,
    }],
    createdAt: now,
    updatedAt: now,
  };
  invocation.evidence[0]!.invocationId = invocation.invocationId;
  next.invocations.push(invocation);
  next.updatedAt = now;
  return { state: next, invocation };
}

export function recordSkillEvidence(
  state: SessionSkillExecutionState,
  invocationId: string,
  event: Omit<SkillEvidenceEvent, 'invocationId' | 'createdAt'> & { createdAt?: number },
): SessionSkillExecutionState {
  const next = cloneSessionSkillExecutionState(state);
  const invocation = next.invocations.find((candidate) => candidate.invocationId === invocationId);
  if (!invocation) {
    return next;
  }

  const createdAt = event.createdAt ?? Date.now();
  const nextEvent: SkillEvidenceEvent = {
    ...event,
    invocationId,
    createdAt,
  };
  if (!hasEquivalentEvidence(invocation.evidence, nextEvent)) {
    invocation.evidence.push(nextEvent);
  }
  invocation.updatedAt = createdAt;
  next.updatedAt = createdAt;
  return next;
}

export function updateSkillCompliance(
  state: SessionSkillExecutionState,
  invocationId: string,
  compliance: SkillComplianceResult,
): SessionSkillExecutionState {
  const next = cloneSessionSkillExecutionState(state);
  const invocation = next.invocations.find((candidate) => candidate.invocationId === invocationId);
  if (!invocation) {
    return next;
  }

  invocation.compliance = {
    ...compliance,
    missingReferences: [...compliance.missingReferences],
    missingScripts: [...compliance.missingScripts],
    missingSteps: [...compliance.missingSteps],
    failedChecks: compliance.failedChecks.map((check) => ({ ...check, terms: [...check.terms] })),
  };
  invocation.status = compliance.passed ? 'completed' : 'incomplete';
  invocation.updatedAt = compliance.checkedAt;
  next.updatedAt = compliance.checkedAt;
  return next;
}

export function findLatestRunningInvocation(
  state: SessionSkillExecutionState,
  agentId?: string,
): SkillInvocationState | undefined {
  const candidates = state.invocations.filter((invocation) => (
    invocation.status === 'running' && (agentId ? invocation.agentId === agentId : true)
  ));
  return candidates.at(-1);
}

export function cloneInvocation(invocation: SkillInvocationState): SkillInvocationState {
  return {
    ...invocation,
    requested: [...invocation.requested],
    plan: cloneSkillExecutionPlan(invocation.plan),
    evidence: invocation.evidence.map((event) => ({ ...event })),
    compliance: invocation.compliance
      ? {
        ...invocation.compliance,
        missingReferences: [...invocation.compliance.missingReferences],
        missingScripts: [...invocation.compliance.missingScripts],
        missingSteps: [...invocation.compliance.missingSteps],
        failedChecks: invocation.compliance.failedChecks.map((check) => ({ ...check, terms: [...check.terms] })),
      }
      : undefined,
  };
}

function cloneSkillExecutionPlan(plan: SkillExecutionPlan): SkillExecutionPlan {
  return {
    ...plan,
    requested: [...plan.requested],
    resolved: plan.resolved.map((step) => ({
      ...step,
      allowedTools: [...step.allowedTools],
      dependsOn: [...step.dependsOn],
      referencesManifest: step.referencesManifest.map((entry) => ({ ...entry })),
      scriptsManifest: step.scriptsManifest.map((entry) => ({ ...entry })),
      assetsManifest: step.assetsManifest.map((entry) => ({ ...entry })),
      requiredReferences: [...step.requiredReferences],
      requiredScripts: [...step.requiredScripts],
      requiredSteps: [...step.requiredSteps],
      successChecks: step.successChecks.map((check) => ({ ...check, terms: [...check.terms] })),
    })),
  };
}

function hashPlan(plan: SkillExecutionPlan): string {
  return createHash('sha1').update(JSON.stringify(plan)).digest('hex');
}

function hasEquivalentEvidence(existing: SkillEvidenceEvent[], candidate: SkillEvidenceEvent): boolean {
  return existing.some((event) => (
    event.type === candidate.type
    && event.agentId === candidate.agentId
    && event.path === candidate.path
    && event.command === candidate.command
    && event.stepId === candidate.stepId
    && event.passed === candidate.passed
  ));
}
