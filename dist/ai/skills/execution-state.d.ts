import type { SkillExecutionPlan } from './planner.js';
import type { SkillComplianceResult } from './compliance.js';
export type SkillInvocationStatus = 'running' | 'completed' | 'incomplete' | 'failed';
export type SkillEvidenceEventType = 'read_reference' | 'run_script' | 'step_completed' | 'success_check_result';
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
export declare function createEmptySessionSkillExecutionState(now?: number): SessionSkillExecutionState;
export declare function cloneSessionSkillExecutionState(state: SessionSkillExecutionState): SessionSkillExecutionState;
export declare function activateSkillInvocation(state: SessionSkillExecutionState, input: {
    sessionId: string;
    agentId: string;
    plan: SkillExecutionPlan;
    requested?: string[];
    now?: number;
}): {
    state: SessionSkillExecutionState;
    invocation: SkillInvocationState;
};
export declare function recordSkillEvidence(state: SessionSkillExecutionState, invocationId: string, event: Omit<SkillEvidenceEvent, 'invocationId' | 'createdAt'> & {
    createdAt?: number;
}): SessionSkillExecutionState;
export declare function updateSkillCompliance(state: SessionSkillExecutionState, invocationId: string, compliance: SkillComplianceResult): SessionSkillExecutionState;
export declare function findLatestRunningInvocation(state: SessionSkillExecutionState, agentId?: string): SkillInvocationState | undefined;
export declare function cloneInvocation(invocation: SkillInvocationState): SkillInvocationState;
