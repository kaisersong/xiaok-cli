import { type SkillComplianceResult } from '../../ai/skills/compliance.js';
import { type SessionSkillExecutionState, type SkillInvocationState } from '../../ai/skills/execution-state.js';
export interface StrictSkillContinuationRunner {
    runContinuation(input: string): Promise<string>;
}
export interface StrictSkillAdherenceFlow {
    maybeRunStrictCompletionLoop(assistantText: string): Promise<string>;
}
export interface StrictSkillAdherenceRecorder {
    record(skillName: string, compliance: SkillComplianceResult): void;
}
export interface StrictSkillAdherenceFlowDeps {
    getTrackedInvocation(): SkillInvocationState | undefined;
    getInvocationById(invocationId: string | null): SkillInvocationState | undefined;
    getSkillExecutionState(): SessionSkillExecutionState;
    setSkillExecutionState(state: SessionSkillExecutionState): void;
    continuationRunner: StrictSkillContinuationRunner;
    adherenceStore: StrictSkillAdherenceRecorder;
    writeProgressTranscriptNote(note: string): void;
}
export declare function createStrictSkillAdherenceFlow(deps: StrictSkillAdherenceFlowDeps): StrictSkillAdherenceFlow;
