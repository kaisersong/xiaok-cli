import type { MessageBlock } from '../../types.js';
import type { IntentPlanDraft } from '../../ai/intent-delegation/types.js';

export interface ChatIntentTurnStateSnapshot {
  activeTurnToken?: string;
  currentTurnIntentPlan?: IntentPlanDraft;
  currentTurnStageIndex: number;
  currentTurnStageStatus: string;
  completedTurnIntentSummaryLine: string;
  activeIntentReminderBlock?: MessageBlock;
}

export interface ChatIntentTurnState {
  beginTurn(turnToken: string): void;
  getSnapshot(): ChatIntentTurnStateSnapshot;
  isActiveTurn(turnToken: string): boolean;
  setPlan(turnToken: string, plan: IntentPlanDraft | undefined): void;
  setActiveIntentReminderBlock(turnToken: string, block: MessageBlock | undefined): void;
  clearTurnContext(turnToken?: string): void;
  clearTurnContextPreservingCompletedSummary(turnToken?: string): void;
  clearCompletedSummary(turnToken?: string): void;
  noteStageActivated(turnToken: string, order: number): void;
  noteStepRunning(turnToken: string): void;
  noteBreadcrumbStatus(turnToken: string, status: 'blocked' | 'running' | 'completed' | 'failed'): void;
  setStageCompleted(turnToken: string, totalStages: number): void;
  captureCompletedSummary(turnToken: string, summaryLine: string): void;
}

const initialSnapshot = (): ChatIntentTurnStateSnapshot => ({
  activeTurnToken: undefined,
  currentTurnIntentPlan: undefined,
  currentTurnStageIndex: 0,
  currentTurnStageStatus: 'Drafting Plan',
  completedTurnIntentSummaryLine: '',
  activeIntentReminderBlock: undefined,
});

export function createChatIntentTurnState(): ChatIntentTurnState {
  let snapshot = initialSnapshot();

  const isActiveTurn = (turnToken: string): boolean => snapshot.activeTurnToken === turnToken;
  const updateActiveTurn = (
    turnToken: string,
    update: (current: ChatIntentTurnStateSnapshot) => ChatIntentTurnStateSnapshot,
  ): void => {
    if (!isActiveTurn(turnToken)) {
      return;
    }
    snapshot = update(snapshot);
  };

  return {
    beginTurn(turnToken) {
      snapshot = {
        ...initialSnapshot(),
        activeTurnToken: turnToken,
      };
    },

    getSnapshot() {
      return { ...snapshot };
    },

    isActiveTurn,

    setPlan(turnToken, plan) {
      updateActiveTurn(turnToken, (current) => ({
        ...current,
        currentTurnIntentPlan: plan,
        currentTurnStageIndex: 0,
        currentTurnStageStatus: 'Drafting Plan',
        completedTurnIntentSummaryLine: '',
      }));
    },

    setActiveIntentReminderBlock(turnToken, block) {
      updateActiveTurn(turnToken, (current) => ({
        ...current,
        activeIntentReminderBlock: block,
      }));
    },

    clearTurnContext(turnToken) {
      if (turnToken && !isActiveTurn(turnToken)) {
        return;
      }
      snapshot = initialSnapshot();
    },

    clearTurnContextPreservingCompletedSummary(turnToken) {
      if (turnToken && !isActiveTurn(turnToken)) {
        return;
      }
      const completedTurnIntentSummaryLine = snapshot.completedTurnIntentSummaryLine;
      snapshot = {
        ...initialSnapshot(),
        completedTurnIntentSummaryLine,
      };
    },

    clearCompletedSummary(turnToken) {
      if (turnToken && !isActiveTurn(turnToken)) {
        return;
      }
      snapshot = {
        ...snapshot,
        completedTurnIntentSummaryLine: '',
      };
    },

    noteStageActivated(turnToken, order) {
      updateActiveTurn(turnToken, (current) => ({
        ...current,
        currentTurnStageIndex: order,
        currentTurnStageStatus: 'Working',
      }));
    },

    noteStepRunning(turnToken) {
      updateActiveTurn(turnToken, (current) => ({
        ...current,
        currentTurnStageStatus: 'Working',
      }));
    },

    noteBreadcrumbStatus(turnToken, status) {
      updateActiveTurn(turnToken, (current) => ({
        ...current,
        currentTurnStageStatus: status === 'blocked' ? 'Waiting User' : 'Working',
      }));
    },

    setStageCompleted(turnToken, totalStages) {
      updateActiveTurn(turnToken, (current) => ({
        ...current,
        currentTurnStageIndex: Math.max(0, totalStages - 1),
        currentTurnStageStatus: 'Completed',
      }));
    },

    captureCompletedSummary(turnToken, summaryLine) {
      updateActiveTurn(turnToken, (current) => ({
        ...current,
        completedTurnIntentSummaryLine: summaryLine,
      }));
    },
  };
}
