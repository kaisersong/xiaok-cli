import { describe, expect, it } from 'vitest';
import type { IntentPlanDraft } from '../../src/ai/intent-delegation/types.js';
import type { MessageBlock } from '../../src/types.js';
import { createChatIntentTurnState } from '../../src/commands/chat/intent-turn-state.js';

function createPlan(overrides: Partial<IntentPlanDraft> = {}): IntentPlanDraft {
  return {
    instanceId: 'inst-1',
    intentId: 'intent-1',
    sessionId: 'session-1',
    rawIntent: 'make report',
    normalizedIntent: 'make report',
    intentType: 'generate',
    deliverable: 'report',
    finalDeliverable: 'report',
    explicitConstraints: [],
    delegationBoundary: [],
    riskTier: 'medium',
    intentMode: 'multi_stage',
    segmentationConfidence: 'high',
    templateId: 'template-1',
    stages: [
      {
        stageId: 'stage-1',
        order: 0,
        label: 'collect',
        intentType: 'generate',
        deliverable: 'markdown',
        templateId: 'template-1',
        riskTier: 'medium',
        dependsOnStageIds: [],
        steps: [],
      },
      {
        stageId: 'stage-2',
        order: 1,
        label: 'compose',
        intentType: 'generate',
        deliverable: 'report',
        templateId: 'template-1',
        riskTier: 'medium',
        dependsOnStageIds: ['stage-1'],
        steps: [],
      },
    ],
    steps: [],
    continuationMode: 'new_intent',
    ...overrides,
  };
}

function createReminder(): MessageBlock {
  return {
    type: 'text',
    text: '<system-reminder>continue active intent</system-reminder>',
  };
}

describe('chat intent turn state', () => {
  it('clears plan, reminder, stage progress, and completed summary for the active turn', () => {
    const state = createChatIntentTurnState();
    const reminder = createReminder();

    state.beginTurn('turn-1');
    state.setPlan('turn-1', createPlan());
    state.setActiveIntentReminderBlock('turn-1', reminder);
    state.noteStageActivated('turn-1', 1);
    state.noteBreadcrumbStatus('turn-1', 'blocked');
    state.captureCompletedSummary('turn-1', 'Intent: report Completed');

    state.clearTurnContext('turn-1');

    expect(state.getSnapshot()).toEqual({
      activeTurnToken: undefined,
      currentTurnIntentPlan: undefined,
      currentTurnStageIndex: 0,
      currentTurnStageStatus: 'Drafting Plan',
      completedTurnIntentSummaryLine: '',
      activeIntentReminderBlock: undefined,
    });
  });

  it('captures completed summary only for the active token and clears it with turn context', () => {
    const state = createChatIntentTurnState();

    state.beginTurn('turn-1');
    state.captureCompletedSummary('old-turn', 'old summary');
    expect(state.getSnapshot().completedTurnIntentSummaryLine).toBe('');

    state.captureCompletedSummary('turn-1', 'new summary');
    expect(state.getSnapshot().completedTurnIntentSummaryLine).toBe('new summary');

    state.clearTurnContext('turn-1');
    expect(state.getSnapshot().completedTurnIntentSummaryLine).toBe('');
  });

  it('can clear active plan context while preserving completed summary for footer handoff', () => {
    const state = createChatIntentTurnState();

    state.beginTurn('turn-1');
    state.setPlan('turn-1', createPlan());
    state.setActiveIntentReminderBlock('turn-1', createReminder());
    state.setStageCompleted('turn-1', 2);
    state.captureCompletedSummary('turn-1', 'Intent: report Completed');

    state.clearTurnContextPreservingCompletedSummary('turn-1');

    expect(state.getSnapshot()).toEqual({
      activeTurnToken: undefined,
      currentTurnIntentPlan: undefined,
      currentTurnStageIndex: 0,
      currentTurnStageStatus: 'Drafting Plan',
      completedTurnIntentSummaryLine: 'Intent: report Completed',
      activeIntentReminderBlock: undefined,
    });
  });

  it('ignores old-token stage and summary updates after beginTurn advances the active token', () => {
    const state = createChatIntentTurnState();

    state.beginTurn('turn-1');
    state.setPlan('turn-1', createPlan());
    state.beginTurn('turn-2');
    state.noteStageActivated('turn-1', 1);
    state.noteBreadcrumbStatus('turn-1', 'blocked');
    state.setStageCompleted('turn-1', 2);
    state.captureCompletedSummary('turn-1', 'old summary');

    expect(state.getSnapshot()).toMatchObject({
      activeTurnToken: 'turn-2',
      currentTurnStageIndex: 0,
      currentTurnStageStatus: 'Drafting Plan',
      completedTurnIntentSummaryLine: '',
    });
  });

  it('maps stage and breadcrumb runtime events into turn-scoped projection state', () => {
    const state = createChatIntentTurnState();

    state.beginTurn('turn-1');
    state.setPlan('turn-1', createPlan());
    state.noteStageActivated('turn-1', 1);
    state.noteBreadcrumbStatus('turn-1', 'blocked');

    expect(state.getSnapshot()).toMatchObject({
      currentTurnStageIndex: 1,
      currentTurnStageStatus: 'Waiting User',
    });

    state.noteStepRunning('turn-1');
    expect(state.getSnapshot().currentTurnStageStatus).toBe('Working');

    state.setStageCompleted('turn-1', 2);
    expect(state.getSnapshot()).toMatchObject({
      currentTurnStageIndex: 1,
      currentTurnStageStatus: 'Completed',
    });
  });
});
