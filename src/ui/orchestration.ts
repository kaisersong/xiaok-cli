import type { MessageBlock } from '../types.js';
import type { IntentLedgerRecord, SessionIntentLedger } from '../runtime/intent-delegation/types.js';

export function formatCurrentIntentSummaryLine(
  ledger: SessionIntentLedger | null | undefined,
  instanceId: string,
): string {
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
  return `Intent: ${activeIntent.deliverable} · ${stageProgress} ${stageLabel} · ${humanizeOverallStatus(activeIntent.overallStatus)}`;
}

export function buildIntentReminderBlock(
  ledger: SessionIntentLedger | null | undefined,
  instanceId: string,
): MessageBlock | undefined {
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

  return {
    type: 'text',
    text: `<system-reminder>${lines.join('\n')}</system-reminder>`,
  };
}

export function formatIntentCreatedTranscriptBlock(
  ledger: SessionIntentLedger | null | undefined,
  intentId: string,
): string {
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

  return [...intentLines, ''].join('\n');
}

export function formatProgressTranscriptBlock(input: {
  stepId: string;
  status: 'running' | 'blocked' | 'completed' | 'failed';
  message: string;
}): string {
  return formatTranscriptRailBlock('Progress', [
    `${humanizeStepId(input.stepId)} · ${humanizeStepStatus(input.status)}`,
    input.message,
  ]);
}

export function formatStageActivatedTranscriptBlock(input: {
  order: number;
  totalStages: number;
  label: string;
}): string {
  return formatTranscriptRailBlock('Stage', [
    `Active stage: ${input.order + 1}/${input.totalStages} ${input.label}`,
  ]);
}

export function formatReceiptTranscriptBlock(note: string): string {
  return formatTranscriptRailBlock('Receipt', [note]);
}

export function formatSalvageTranscriptBlock(summary: string[], reason?: string): string {
  const lines: string[] = [];
  for (const item of summary) {
    lines.push(`- ${item}`);
  }
  if (reason) {
    lines.push(`Reason: ${reason}`);
  }
  return formatTranscriptRailBlock('Salvage', lines);
}

function getOwnedActiveIntent(
  ledger: SessionIntentLedger | null | undefined,
  instanceId: string,
): IntentLedgerRecord | undefined {
  if (!ledger?.activeIntentId) {
    return undefined;
  }

  const ownerInstanceId = ledger.ownership.ownerInstanceId ?? ledger.ownership.previousOwnerInstanceId;
  if (ownerInstanceId && ownerInstanceId !== instanceId) {
    return undefined;
  }

  return ledger.intents.find((intent) => intent.intentId === ledger.activeIntentId);
}

function humanizeStepId(stepId: string): string {
  return humanizeStepKey(stepId.split(':step:')[1] ?? stepId);
}

function describeActiveStage(intent: IntentLedgerRecord): string {
  const stages = getIntentStages(intent);
  const activeStage = stages.find((stage) => stage.stageId === intent.activeStageId) ?? stages[0];
  if (!activeStage) {
    return 'Waiting';
  }

  return `${activeStage.order + 1}/${stages.length} ${activeStage.label}`;
}

function getIntentStages(intent: IntentLedgerRecord): Array<{ stageId: string; order: number; label: string }> {
  if (Array.isArray(intent.stages) && intent.stages.length > 0) {
    return intent.stages;
  }

  return [{
    stageId: intent.activeStageId ?? `${intent.intentId}:stage:1`,
    order: 0,
    label: `生成${intent.finalDeliverable ?? intent.deliverable}`,
  }];
}

function describePreferredStageSkills(intent: IntentLedgerRecord): string {
  const preferred = intent.stages
    .map((stage) => {
      const skillName = stage.steps
        .map((step) => step.skillName)
        .find((name): name is string => typeof name === 'string' && !name.startsWith('generic_llm::'));
      if (!skillName) {
        return null;
      }
      return `${stage.label} -> ${skillName}`;
    })
    .filter((value): value is string => Boolean(value));

  return preferred.join(' | ');
}

function buildIntentAcknowledgement(intent: IntentLedgerRecord): string {
  const stages = getIntentStages(intent);
  if (stages.length > 1) {
    return `🤝 已理解，会先${stages.map((stage) => stage.label).join('，再')}。`;
  }

  const deliverable = intent.finalDeliverable ?? intent.deliverable;
  return `🤝 已理解，会帮你产出${deliverable}。`;
}

function humanizeStepKey(stepKey: string): string {
  return stepKey
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

function humanizeStepStatus(status: 'running' | 'blocked' | 'completed' | 'failed'): string {
  if (status === 'running') return 'Running';
  if (status === 'blocked') return 'Blocked';
  if (status === 'completed') return 'Completed';
  return 'Failed';
}

function humanizeOverallStatus(status: IntentLedgerRecord['overallStatus']): string {
  return status
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

function formatTranscriptRailBlock(title: string, lines: string[]): string {
  const body = lines.length > 0 ? lines : [''];
  return [
    `╭─ ${title}`,
    ...body.map((line) => `│ ${line}`),
    '╰─',
    '',
  ].join('\n');
}
