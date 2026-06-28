import { intentHint, intentHintDot } from './render.js';
const TERMINAL_INTENT_STATUSES = new Set(['completed', 'failed', 'cancelled']);
export function formatCurrentIntentSummaryLine(ledger, instanceId) {
    const activeIntent = getOwnedActiveIntent(ledger, instanceId);
    if (!activeIntent) {
        return '';
    }
    const stages = getIntentStages(activeIntent);
    const activeStage = stages.find((stage) => stage.stageId === activeIntent.activeStageId) ?? stages[0];
    const stageLabel = activeStage?.label ?? 'Waiting';
    const stageProgress = activeStage
        ? `Stage ${activeStage.order + 1}/${stages.length}`
        : 'Stage';
    return formatIntentSummaryHint(`Intent: ${activeIntent.deliverable} · ${stageProgress} ${stageLabel} · ${humanizeOverallStatus(activeIntent.overallStatus)}`);
}
export function formatCurrentTurnIntentSummaryLine(input) {
    const skillText = formatSkillSummary(input.skillNames ?? []);
    return formatIntentSummaryHint(`Intent: ${input.deliverable} · Stage ${input.stageOrder + 1}/${input.totalStages} ${input.stageLabel}${skillText} · ${input.status}`);
}
export function buildIntentReminderBlock(ledger, instanceId) {
    const activeIntent = getOwnedActiveIntent(ledger, instanceId);
    if (!activeIntent) {
        return undefined;
    }
    const lines = [
        'Intent run contract:',
        `Goal chain: ${activeIntent.deliverable}`,
        `Final deliverable: ${activeIntent.finalDeliverable}`,
        `Active stage: ${describeActiveStage(activeIntent)}`,
        `Risk: ${activeIntent.riskTier}`,
    ];
    const providedSourcePaths = activeIntent.providedSourcePaths ?? [];
    if (providedSourcePaths.length > 0) {
        lines.push(`Provided sources: ${providedSourcePaths.join(' | ')}`);
    }
    const preferredStageSkills = describePreferredStageSkills(activeIntent);
    if (preferredStageSkills) {
        lines.push(`Preferred stage skills: ${preferredStageSkills}`);
    }
    if (activeIntent.delegationBoundary.length > 0) {
        lines.push(`Boundary: ${activeIntent.delegationBoundary.join(' | ')}`);
    }
    if (activeIntent.latestBreadcrumb) {
        lines.push(`Latest progress: ${activeIntent.latestBreadcrumb}`);
    }
    const constraints = activeIntent.explicitConstraints ?? [];
    if (constraints.length > 0) {
        lines.push(`Constraints (must follow): ${constraints.join('; ')}`);
    }
    return {
        type: 'text',
        text: `<system-reminder>${lines.join('\n')}</system-reminder>`,
    };
}
export function formatIntentCreatedTranscriptBlock(ledger, intentId) {
    const intent = ledger?.intents.find((candidate) => candidate.intentId === intentId);
    if (!intent) {
        return '';
    }
    const intentLines = [buildIntentAcknowledgement(intent)];
    const providedSourcePaths = intent.providedSourcePaths ?? [];
    if (providedSourcePaths.length > 0) {
        intentLines.push(`来源：${providedSourcePaths.join(' | ')}`);
    }
    if (intent.delegationBoundary.length > 0) {
        intentLines.push(`边界：${intent.delegationBoundary.join(' | ')}`);
    }
    return intentHint([...intentLines, ''].join('\n'));
}
export function formatProgressTranscriptBlock(input) {
    return formatTranscriptRailBlock('Progress', [
        `${humanizeStepId(input.stepId)} · ${humanizeStepStatus(input.status)}`,
        input.message,
    ]);
}
export function formatStageActivatedTranscriptBlock(input) {
    return formatTranscriptRailBlock('Stage', [
        `Active stage: ${input.order + 1}/${input.totalStages} ${input.label}`,
    ]);
}
export function formatIntentStageSummaryTranscriptBlock(input) {
    return formatTranscriptRailBlock('Stages', [
        `Goal: ${input.deliverable}`,
        ...input.stages.map((stage) => (`Stage ${stage.order + 1}/${stage.totalStages} ${stage.label}${formatSkillSummary(stage.skillNames ?? [])} · ${stage.status}`)),
    ]);
}
export function formatReceiptTranscriptBlock(note) {
    return formatTranscriptRailBlock('Receipt', [note]);
}
export function formatSalvageTranscriptBlock(summary, reason) {
    const lines = [];
    for (const item of summary) {
        lines.push(`- ${item}`);
    }
    if (reason) {
        lines.push(`Reason: ${reason}`);
    }
    return formatTranscriptRailBlock('Salvage', lines);
}
function getOwnedActiveIntent(ledger, instanceId) {
    if (!ledger?.activeIntentId) {
        return undefined;
    }
    const ownerInstanceId = ledger.ownership.ownerInstanceId ?? ledger.ownership.previousOwnerInstanceId;
    if (ownerInstanceId && ownerInstanceId !== instanceId) {
        return undefined;
    }
    const activeIntent = ledger.intents.find((intent) => intent.intentId === ledger.activeIntentId);
    if (!activeIntent || TERMINAL_INTENT_STATUSES.has(activeIntent.overallStatus)) {
        return undefined;
    }
    return activeIntent;
}
function humanizeStepId(stepId) {
    return humanizeStepKey(stepId.split(':step:')[1] ?? stepId);
}
function describeActiveStage(intent) {
    const stages = getIntentStages(intent);
    const activeStage = stages.find((stage) => stage.stageId === intent.activeStageId) ?? stages[0];
    if (!activeStage) {
        return 'Waiting';
    }
    return `${activeStage.order + 1}/${stages.length} ${activeStage.label}`;
}
function getIntentStages(intent) {
    if (Array.isArray(intent.stages) && intent.stages.length > 0) {
        return intent.stages;
    }
    return [{
            stageId: intent.activeStageId ?? `${intent.intentId}:stage:1`,
            order: 0,
            label: `生成${intent.finalDeliverable ?? intent.deliverable}`,
            steps: intent.steps,
        }];
}
function describePreferredStageSkills(intent) {
    const preferred = intent.stages
        .map((stage) => {
        const skillName = stage.steps
            .map((step) => step.skillName)
            .find((name) => typeof name === 'string' && !name.startsWith('generic_llm::'));
        if (!skillName) {
            return null;
        }
        return `${stage.label} -> ${skillName}`;
    })
        .filter((value) => Boolean(value));
    return preferred.join(' | ');
}
function formatSkillSummary(skillNames) {
    const normalized = [...new Set(skillNames
            .map((name) => typeof name === 'string' ? name.trim() : '')
            .filter((name) => name && !name.startsWith('generic_llm::')))];
    if (normalized.length === 0) {
        return '';
    }
    return ` · ${normalized.length === 1 ? 'Skill' : 'Skills'}: ${normalized.join(', ')}`;
}
function buildIntentAcknowledgement(intent) {
    const stages = getIntentStages(intent);
    if (stages.length > 1) {
        return `🤝 已理解，会先${stages.map((stage) => stage.label).join('，再')}。`;
    }
    const deliverable = intent.finalDeliverable ?? intent.deliverable;
    return `🤝 已理解，会帮你产出${deliverable}。`;
}
function formatIntentSummaryHint(text) {
    return `${intentHintDot('●')} ${intentHint(text)}`;
}
function humanizeStepKey(stepKey) {
    return stepKey
        .split(/[_-]+/g)
        .filter(Boolean)
        .map((part) => part[0]?.toUpperCase() + part.slice(1))
        .join(' ');
}
function humanizeStepStatus(status) {
    if (status === 'running')
        return 'Running';
    if (status === 'blocked')
        return 'Blocked';
    if (status === 'completed')
        return 'Completed';
    return 'Failed';
}
function humanizeOverallStatus(status) {
    return status
        .split(/[_-]+/g)
        .filter(Boolean)
        .map((part) => part[0]?.toUpperCase() + part.slice(1))
        .join(' ');
}
function formatTranscriptRailBlock(title, lines) {
    const body = lines.length > 0 ? lines : [''];
    return [
        `╭─ ${title}`,
        ...body.map((line) => `│ ${line}`),
        '╰─',
        '',
    ].join('\n');
}
