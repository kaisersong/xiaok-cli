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
export declare function createChatIntentTurnState(): ChatIntentTurnState;
