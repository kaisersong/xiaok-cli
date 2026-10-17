import type { MessageBlock } from '../types.js';
import { intentHint, intentHintDot } from './render.js';

/** Only the DATA read by the three stored-intent presenters; never Modern or authority. */
export interface IntentPresentationRecordData {
  readonly intentId: unknown;
  readonly deliverable?: unknown;
  readonly finalDeliverable?: unknown;
  readonly overallStatus?: unknown;
  readonly activeStageId?: unknown;
  readonly stages?: unknown;
  readonly steps?: unknown;
  readonly riskTier?: unknown;
  readonly providedSourcePaths?: unknown;
  readonly delegationBoundary?: unknown;
  readonly explicitConstraints?: unknown;
  readonly latestBreadcrumb?: unknown;
}
export interface IntentPresentationLedgerData {
  readonly activeIntentId?: unknown;
  readonly ownership: { readonly ownerInstanceId?: unknown; readonly previousOwnerInstanceId?: unknown };
  readonly intents: readonly IntentPresentationRecordData[];
}
const TERMINAL_INTENT_STATUSES = new Set<unknown>(['completed', 'failed', 'cancelled']);

function presentationFail(field: string): never { throw new TypeError(`intent_presentation:${field}`); }
function presentationText(value: unknown, field: string): string {
  if (typeof value !== 'string') return presentationFail(field);
  return value;
}
function presentationNumber(value: unknown, field: string): number {
  // Preserve original number arithmetic, including fractions and non-finite values.
  if (typeof value !== 'number') return presentationFail(field);
  return value;
}
function presentationObject(value: unknown, field: string): Record<string, unknown> {
  if (!isPresentationObject(value)) return presentationFail(field);
  return value;
}
function isPresentationObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function presentationArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) return presentationFail(field);
  return value;
}
function presentationStrings(value: unknown, field: string): readonly string[] {
  return presentationArray(value, field).map(entry => presentationText(entry, field));
}
function presentationStage(value: unknown): Record<string, unknown> {
  return presentationObject(value, 'stage');
}

export function formatCurrentIntentSummaryLine(
  ledger: IntentPresentationLedgerData | null | undefined,
  instanceId: string,
): string {
  const activeIntent = getOwnedActiveIntent(ledger, instanceId);
  if (!activeIntent) return '';
  const stages = getIntentStages(activeIntent);
  const activeStage = stages.find(stage => presentationStage(stage).stageId === activeIntent.activeStageId) ?? stages[0];
  const stage = activeStage === undefined ? undefined : presentationStage(activeStage);
  const stageLabel = stage ? presentationText(stage.label ?? 'Waiting', 'stage.label') : 'Waiting';
  const stageProgress = stage ? `Stage ${presentationNumber(stage.order, 'stage.order') + 1}/${stages.length}` : 'Stage';
  return formatIntentSummaryHint(
    `Intent: ${presentationText(activeIntent.deliverable, 'deliverable')} · ${stageProgress} ${stageLabel} · ${humanizeOverallStatus(activeIntent.overallStatus)}`,
  );
}

export function formatCurrentTurnIntentSummaryLine(input: {
  deliverable: string;
  stageOrder: number;
  totalStages: number;
  stageLabel: string;
  skillNames?: string[];
  status: string;
}): string {
  const skillText = formatSkillSummary(input.skillNames ?? []);
  return formatIntentSummaryHint(
    `Intent: ${input.deliverable} · Stage ${input.stageOrder + 1}/${input.totalStages} ${input.stageLabel}${skillText} · ${input.status}`,
  );
}

export function buildIntentReminderBlock(
  ledger: IntentPresentationLedgerData | null | undefined,
  instanceId: string,
): MessageBlock | undefined {
  const activeIntent = getOwnedActiveIntent(ledger, instanceId);
  if (!activeIntent) return undefined;
  const lines = [
    'Intent run contract:',
    `Goal chain: ${presentationText(activeIntent.deliverable, 'deliverable')}`,
    `Final deliverable: ${presentationText(activeIntent.finalDeliverable, 'finalDeliverable')}`,
    `Active stage: ${describeActiveStage(activeIntent)}`,
    `Risk: ${presentationText(activeIntent.riskTier, 'riskTier')}`,
  ];
  const providedSourcePaths = presentationStrings(activeIntent.providedSourcePaths ?? [], 'providedSourcePaths');
  if (providedSourcePaths.length > 0) lines.push(`Provided sources: ${providedSourcePaths.join(' | ')}`);
  const preferredStageSkills = describePreferredStageSkills(activeIntent);
  if (preferredStageSkills) lines.push(`Preferred stage skills: ${preferredStageSkills}`);
  const boundary = presentationStrings(activeIntent.delegationBoundary, 'delegationBoundary');
  if (boundary.length > 0) lines.push(`Boundary: ${boundary.join(' | ')}`);
  if (activeIntent.latestBreadcrumb) lines.push(`Latest progress: ${presentationText(activeIntent.latestBreadcrumb, 'latestBreadcrumb')}`);
  const constraints = presentationStrings(activeIntent.explicitConstraints ?? [], 'explicitConstraints');
  if (constraints.length > 0) lines.push(`Constraints (must follow): ${constraints.join('; ')}`);
  return { type: 'text', text: `<system-reminder>${lines.join('\n')}</system-reminder>` };
}

export function formatIntentCreatedTranscriptBlock(
  ledger: Pick<IntentPresentationLedgerData, 'intents'> | null | undefined,
  intentId: string,
): string {
  const intent = ledger?.intents.find(candidate => candidate.intentId === intentId);
  if (!intent) return '';
  const intentLines = [buildIntentAcknowledgement(intent)];
  const paths = presentationStrings(intent.providedSourcePaths ?? [], 'providedSourcePaths');
  if (paths.length > 0) intentLines.push(`来源：${paths.join(' | ')}`);
  const boundary = presentationStrings(intent.delegationBoundary, 'delegationBoundary');
  if (boundary.length > 0) intentLines.push(`边界：${boundary.join(' | ')}`);
  return intentHint([...intentLines, ''].join('\n'));
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

export function formatIntentStageSummaryTranscriptBlock(input: {
  deliverable: string;
  stages: Array<{
    order: number;
    totalStages: number;
    label: string;
    skillNames?: string[];
    status: string;
  }>;
}): string {
  return formatTranscriptRailBlock('Stages', [
    `Goal: ${input.deliverable}`,
    ...input.stages.map((stage) => (
      `Stage ${stage.order + 1}/${stage.totalStages} ${stage.label}${formatSkillSummary(stage.skillNames ?? [])} · ${stage.status}`
    )),
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
  ledger: IntentPresentationLedgerData | null | undefined,
  instanceId: string,
): IntentPresentationRecordData | undefined {
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

function humanizeStepId(stepId: string): string {
  return humanizeStepKey(stepId.split(':step:')[1] ?? stepId);
}

function describeActiveStage(intent: IntentPresentationRecordData): string {
  const stages = getIntentStages(intent);
  const activeStage = stages.find(stage => presentationStage(stage).stageId === intent.activeStageId) ?? stages[0];
  if (activeStage === undefined) return 'Waiting';
  const stage = presentationStage(activeStage);
  return `${presentationNumber(stage.order, 'stage.order') + 1}/${stages.length} ${presentationText(stage.label, 'stage.label')}`;
}

function getIntentStages(intent: IntentPresentationRecordData): readonly unknown[] {
  if (intent.stages != null) {
    const stages = presentationArray(intent.stages, 'stages');
    if (stages.length > 0) return stages;
  }
  // Retain this existing display-only legacy fallback; never write it into DATA.
  return [{
    stageId: intent.activeStageId ?? `${presentationText(intent.intentId, 'intentId')}:stage:1`,
    order: 0,
    label: `生成${presentationText(intent.finalDeliverable ?? intent.deliverable, 'finalDeliverable')}`,
    steps: intent.steps,
  }];
}

function describePreferredStageSkills(intent: IntentPresentationRecordData): string {
  const preferred = presentationArray(intent.stages, 'stages')
    .map(value => {
      const stage = presentationStage(value);
      const skillName = presentationArray(stage.steps, 'stage.steps')
        .map(step => presentationObject(step, 'step').skillName)
        .find((name): name is string => typeof name === 'string' && !name.startsWith('generic_llm::'));
      if (!skillName) return null;
      return `${presentationText(stage.label, 'stage.label')} -> ${skillName}`;
    })
    .filter((value): value is string => Boolean(value));
  return preferred.join(' | ');
}

function formatSkillSummary(skillNames: Array<string | null | undefined>): string {
  const normalized = [...new Set(skillNames
    .map((name) => typeof name === 'string' ? name.trim() : '')
    .filter((name) => name && !name.startsWith('generic_llm::')))];
  if (normalized.length === 0) {
    return '';
  }
  return ` · ${normalized.length === 1 ? 'Skill' : 'Skills'}: ${normalized.join(', ')}`;
}

function buildIntentAcknowledgement(intent: IntentPresentationRecordData): string {
  const stages = getIntentStages(intent);
  if (stages.length > 1) {
    return `🤝 已理解，会先${stages.map(stage => presentationText(presentationStage(stage).label, 'stage.label')).join('，再')}。`;
  }
  const deliverable = presentationText(intent.finalDeliverable ?? intent.deliverable, 'finalDeliverable');
  return `🤝 已理解，会帮你产出${deliverable}。`;
}

function formatIntentSummaryHint(text: string): string {
  return `${intentHintDot('●')} ${intentHint(text)}`;
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

function humanizeOverallStatus(status: unknown): string {
  return presentationText(status, 'overallStatus')
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
