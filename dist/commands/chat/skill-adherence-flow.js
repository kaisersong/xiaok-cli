import { buildComplianceReminder, evaluateSkillCompliance, } from '../../ai/skills/compliance.js';
import { recordSkillEvidence, updateSkillCompliance, } from '../../ai/skills/execution-state.js';
export function createStrictSkillAdherenceFlow(deps) {
    const setSkillExecutionState = (state) => {
        deps.setSkillExecutionState(state);
    };
    const applyComplianceResult = (invocation, finalAnswerText) => {
        const liveInvocation = deps.getInvocationById(invocation.invocationId) ?? invocation;
        const compliance = evaluateSkillCompliance({
            plan: liveInvocation.plan,
            evidence: buildComplianceEvidenceView(liveInvocation),
            finalAnswer: finalAnswerText,
        });
        setSkillExecutionState(updateSkillCompliance(deps.getSkillExecutionState(), liveInvocation.invocationId, compliance));
        const refreshedInvocation = deps.getInvocationById(liveInvocation.invocationId);
        if (refreshedInvocation) {
            if (compliance.missingReferences.length === 0) {
                setSkillExecutionState(recordSkillEvidence(deps.getSkillExecutionState(), liveInvocation.invocationId, {
                    type: 'step_completed',
                    agentId: refreshedInvocation.agentId,
                    stepId: 'read_required_references',
                }));
            }
            if (compliance.missingScripts.length === 0) {
                setSkillExecutionState(recordSkillEvidence(deps.getSkillExecutionState(), liveInvocation.invocationId, {
                    type: 'step_completed',
                    agentId: refreshedInvocation.agentId,
                    stepId: 'run_required_scripts',
                }));
            }
            if (/\S/.test(finalAnswerText)) {
                setSkillExecutionState(recordSkillEvidence(deps.getSkillExecutionState(), liveInvocation.invocationId, {
                    type: 'step_completed',
                    agentId: refreshedInvocation.agentId,
                    stepId: 'summarize_findings',
                }));
            }
            for (const failedCheck of compliance.failedChecks) {
                setSkillExecutionState(recordSkillEvidence(deps.getSkillExecutionState(), liveInvocation.invocationId, {
                    type: 'success_check_result',
                    agentId: refreshedInvocation.agentId,
                    stepId: `${failedCheck.type}:${failedCheck.terms.join('|')}`,
                    passed: false,
                }));
            }
            for (const step of liveInvocation.plan.resolved) {
                for (const successCheck of step.successChecks) {
                    const key = `${successCheck.type}:${successCheck.terms.join('|')}`;
                    const failed = compliance.failedChecks.some((check) => `${check.type}:${check.terms.join('|')}` === key);
                    if (!failed) {
                        setSkillExecutionState(recordSkillEvidence(deps.getSkillExecutionState(), liveInvocation.invocationId, {
                            type: 'success_check_result',
                            agentId: refreshedInvocation.agentId,
                            stepId: key,
                            passed: true,
                        }));
                    }
                }
            }
        }
        return compliance;
    };
    return {
        async maybeRunStrictCompletionLoop(assistantText) {
            let combinedAssistantText = assistantText;
            const invocation = deps.getTrackedInvocation();
            if (!invocation?.strictMode) {
                return combinedAssistantText;
            }
            let latestInvocation = invocation;
            let finalCompliance = applyComplianceResult(latestInvocation, combinedAssistantText);
            let attempts = 0;
            while (!finalCompliance.passed && attempts < 2) {
                attempts += 1;
                const continuationText = await deps.continuationRunner.runContinuation(buildComplianceReminder(finalCompliance));
                combinedAssistantText += continuationText;
                latestInvocation = deps.getInvocationById(latestInvocation.invocationId) ?? latestInvocation;
                finalCompliance = applyComplianceResult(latestInvocation, combinedAssistantText);
            }
            deps.adherenceStore.record(latestInvocation.skillName, finalCompliance);
            if (!finalCompliance.passed) {
                deps.writeProgressTranscriptNote(formatFailedComplianceProgressNote(finalCompliance));
            }
            return combinedAssistantText;
        },
    };
}
function buildComplianceEvidenceView(invocation) {
    return {
        readReferences: invocation.evidence
            .filter((event) => event.type === 'read_reference' && event.path)
            .map((event) => event.path),
        runScripts: invocation.evidence
            .filter((event) => event.type === 'run_script' && event.command)
            .map((event) => event.command),
        completedSteps: invocation.evidence
            .filter((event) => event.type === 'step_completed' && event.stepId)
            .map((event) => event.stepId),
    };
}
function formatFailedComplianceProgressNote(compliance) {
    return `Strict skill contract still incomplete: ${[
        ...compliance.missingReferences.map((item) => `reference:${item}`),
        ...compliance.missingScripts.map((item) => `script:${item}`),
        ...compliance.missingSteps.map((item) => `step:${item}`),
        ...compliance.failedChecks.map((item) => `check:${item.type}`),
    ].join(', ')}`;
}
