import { describe, expect, it } from 'vitest';
import {
  buildIntentReminderBlock,
  formatCurrentIntentSummaryLine,
  formatIntentCreatedTranscriptBlock,
  formatProgressTranscriptBlock,
  formatReceiptTranscriptBlock,
  formatSalvageTranscriptBlock,
  formatStageActivatedTranscriptBlock,
} from '../../src/ui/orchestration.js';
import type { IntentLedgerRecord, SessionIntentLedger } from '../../src/runtime/intent-delegation/types.js';

describe('ui orchestration formatting', () => {
  it('formats a sticky summary line only for the owning instance', () => {
    const ledger = createLedger();

    expect(formatCurrentIntentSummaryLine(ledger, 'inst_owner')).toContain('Intent: Customer proposal');
    expect(formatCurrentIntentSummaryLine(ledger, 'inst_other')).toBe('');
  });

  it('builds an intent reminder block from the active intent', () => {
    const reminder = buildIntentReminderBlock(createLedger(), 'inst_owner');

    expect(reminder).toEqual({
      type: 'text',
      text: expect.stringContaining('Intent run contract'),
    });
    expect(reminder?.text).toContain('Customer proposal');
    expect(reminder?.text).toContain('Collect');
  });

  it('includes preferred stage skills in the hidden run contract when non-generic skills are planned', () => {
    const reminder = buildIntentReminderBlock(createLedger({
      stages: [
        {
          stageId: 'intent_customer_proposal:stage:1',
          order: 0,
          label: '提取 Markdown',
          intentType: 'generate',
          deliverable: 'md',
          templateId: 'generate_v1',
          riskTier: 'medium',
          dependsOnStageIds: [],
          steps: [
            {
              stepId: 'intent_customer_proposal:stage:1:step:collect',
              key: 'collect',
              order: 0,
              role: 'collect',
              skillName: 'generic_llm::collect',
              dependsOn: [],
              status: 'planned',
              riskTier: 'medium',
            },
          ],
          status: 'running',
          activeStepId: 'intent_customer_proposal:stage:1:step:collect',
          structuralValidation: 'pending',
          semanticValidation: 'pending',
          needsFreshContextHandoff: false,
        },
        {
          stageId: 'intent_customer_proposal:stage:2',
          order: 1,
          label: '生成报告',
          intentType: 'generate',
          deliverable: '报告',
          templateId: 'generate_v1',
          riskTier: 'medium',
          dependsOnStageIds: ['intent_customer_proposal:stage:1'],
          steps: [
            {
              stepId: 'intent_customer_proposal:stage:2:step:compose',
              key: 'compose',
              order: 0,
              role: 'compose',
              skillName: 'kai-report-creator',
              dependsOn: [],
              status: 'planned',
              riskTier: 'medium',
            },
          ],
          status: 'planned',
          activeStepId: 'intent_customer_proposal:stage:2:step:compose',
          structuralValidation: 'pending',
          semanticValidation: 'pending',
          needsFreshContextHandoff: true,
        },
      ],
    }), 'inst_owner');

    expect(reminder?.text).toContain('Preferred stage skills: 生成报告 -> kai-report-creator');
  });

  it('includes authoritative source paths when present without forcing output path hints into the UI', () => {
    const reminder = buildIntentReminderBlock(createLedger({
      deliverable: 'md -> 报告',
      finalDeliverable: '报告',
      providedSourcePaths: ['/Users/song/Downloads/salesforce_ai_evolution.html'],
      stages: [
        {
          stageId: 'intent_customer_proposal:stage:1',
          order: 0,
          label: '提取 Markdown',
          intentType: 'generate',
          deliverable: 'md',
          templateId: 'generate_v1',
          riskTier: 'medium',
          dependsOnStageIds: [],
          steps: [],
          status: 'running',
          activeStepId: 'intent_customer_proposal:stage:1:step:collect',
          structuralValidation: 'pending',
          semanticValidation: 'pending',
          needsFreshContextHandoff: false,
        },
        {
          stageId: 'intent_customer_proposal:stage:2',
          order: 1,
          label: '生成报告',
          intentType: 'generate',
          deliverable: '报告',
          templateId: 'generate_v1',
          riskTier: 'medium',
          dependsOnStageIds: ['intent_customer_proposal:stage:1'],
          steps: [],
          status: 'planned',
          activeStepId: 'intent_customer_proposal:stage:2:step:collect',
          structuralValidation: 'pending',
          semanticValidation: 'pending',
          needsFreshContextHandoff: true,
        },
      ],
      activeStageId: 'intent_customer_proposal:stage:1',
    }), 'inst_owner');

    expect(reminder?.text).toContain('Provided sources: /Users/song/Downloads/salesforce_ai_evolution.html');
    expect(reminder?.text).not.toContain('Suggested safe outputs:');
  });

  it('renders transcript blocks for intent, progress, receipt, and salvage updates', () => {
    const ledger = createLedger();
    const intentBlock = formatIntentCreatedTranscriptBlock(ledger, 'intent_customer_proposal');

    expect(intentBlock).toContain('🤝 已理解，会帮你产出Customer proposal。');
    expect(intentBlock).not.toContain('╭─');
    expect(intentBlock).not.toContain('│ ');
    expect(intentBlock).not.toContain('╭─ Plan');
    expect(intentBlock).not.toContain('Template: generate_v1');
    expect(intentBlock).not.toContain('Type:');
    expect(intentBlock).not.toContain('Risk:');
    expect(formatProgressTranscriptBlock({
      stepId: 'intent_customer_proposal:step:collect',
      status: 'running',
      message: 'Collected the customer constraints',
    })).toContain('╭─ Progress');
    expect(formatReceiptTranscriptBlock('Delivered a first draft')).toContain('╭─ Receipt');
    expect(formatSalvageTranscriptBlock(['Outline is reusable', 'Constraints are captured'], 'waiting on approval')).toContain('╭─ Salvage');
  });

  it('renders a dedicated stage-activation transcript block', () => {
    expect(formatStageActivatedTranscriptBlock({
      order: 1,
      totalStages: 2,
      label: '生成报告',
    })).toContain('Active stage: 2/2 生成报告');
  });

  it('labels chained deliverables as Deliverables instead of Deliverable', () => {
    const ledger = createLedger({
      deliverable: 'md -> Customer proposal',
      stages: [
        {
          stageId: 'intent_customer_proposal:stage:1',
          order: 0,
          label: '提取 Markdown',
          intentType: 'generate',
          deliverable: 'md',
          templateId: 'generate_v1',
          riskTier: 'medium',
          dependsOnStageIds: [],
          steps: [],
          status: 'running',
          activeStepId: 'intent_customer_proposal:stage:1:step:collect',
          structuralValidation: 'pending',
          semanticValidation: 'pending',
          needsFreshContextHandoff: false,
        },
        {
          stageId: 'intent_customer_proposal:stage:2',
          order: 1,
          label: '生成报告',
          intentType: 'generate',
          deliverable: 'Customer proposal',
          templateId: 'generate_v1',
          riskTier: 'medium',
          dependsOnStageIds: ['intent_customer_proposal:stage:1'],
          steps: [],
          status: 'planned',
          activeStepId: 'intent_customer_proposal:stage:2:step:compose',
          structuralValidation: 'pending',
          semanticValidation: 'pending',
          needsFreshContextHandoff: true,
        },
      ],
    });

    const intentBlock = formatIntentCreatedTranscriptBlock(ledger, 'intent_customer_proposal');
    expect(intentBlock).toContain('🤝 已理解，会先提取 Markdown，再生成报告。');
    expect(intentBlock).not.toContain('Deliverables:');
  });
});

function createLedger(overrides: Partial<IntentLedgerRecord> = {}): SessionIntentLedger {
  const intent = createIntent(overrides);
  return {
    instanceId: 'plan_customer_proposal',
    sessionId: 'sess_1',
    activeIntentId: intent.intentId,
    latestPlan: intent,
    intents: [intent],
    breadcrumbs: [],
    receipt: null,
    salvage: null,
    ownership: {
      state: 'owned',
      ownerInstanceId: 'inst_owner',
      previousOwnerInstanceId: undefined,
      updatedAt: 1700000000000,
    },
    updatedAt: 1700000000000,
  };
}

function createIntent(overrides: Partial<IntentLedgerRecord> = {}): IntentLedgerRecord {
  return {
    intentId: 'intent_customer_proposal',
    instanceId: 'plan_customer_proposal',
    sessionId: 'sess_1',
    rawIntent: 'Write a customer proposal',
    normalizedIntent: 'write a customer proposal',
    intentType: 'generate',
    deliverable: 'Customer proposal',
    explicitConstraints: ['Use Chinese'],
    delegationBoundary: ['Do not send externally'],
    providedSourcePaths: [],
    riskTier: 'medium',
    finalDeliverable: overrides.finalDeliverable ?? overrides.deliverable ?? 'Customer proposal',
    intentMode: 'single_stage',
    segmentationConfidence: 'low',
    templateId: 'generate_v1',
    stages: overrides.stages ?? [{
      stageId: 'intent_customer_proposal:stage:1',
      order: 0,
      label: 'Collect',
      intentType: 'generate',
      deliverable: overrides.finalDeliverable ?? overrides.deliverable ?? 'Customer proposal',
      templateId: 'generate_v1',
      riskTier: 'medium',
      dependsOnStageIds: [],
      steps: [],
      status: 'running',
      activeStepId: 'intent_customer_proposal:step:collect',
      structuralValidation: 'pending',
      semanticValidation: 'pending',
      needsFreshContextHandoff: false,
    }],
    activeStageId: overrides.activeStageId ?? 'intent_customer_proposal:stage:1',
    steps: [
      {
        stepId: 'intent_customer_proposal:step:collect',
        key: 'collect',
        order: 0,
        role: 'researcher',
        skillName: null,
        dependsOn: [],
        status: 'running',
        riskTier: 'medium',
      },
      {
        stepId: 'intent_customer_proposal:step:draft',
        key: 'draft',
        order: 1,
        role: 'writer',
        skillName: null,
        dependsOn: ['intent_customer_proposal:step:collect'],
        status: 'planned',
        riskTier: 'medium',
      },
    ],
    activeStepId: 'intent_customer_proposal:step:collect',
    overallStatus: 'drafting_plan',
    attemptCount: 1,
    latestBreadcrumb: 'Collected the customer constraints',
    latestReceipt: 'Delivered a first draft',
    salvageSummary: ['Outline is reusable'],
    createdAt: 1700000000000,
    updatedAt: 1700000000001,
    ...overrides,
  };
}
