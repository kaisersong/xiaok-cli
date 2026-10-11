/** Public IPC/UI data types only. Runtime services and authority stay in Main. */
export type { LoopRunObservationDto as LoopRunObservationView, AutomationRunHistoryDto as AutomationRunHistoryItem } from './loop-current-view-ipc-contract.js';
export type { DesktopGoalNativeMutationProjection } from '../electron/desktop-goal-coordinator.js';
export type { GoalCompletionObservation } from '../../src/runtime/goal/completion-observation.js';
export type { GoalActivation, GoalCreationInput, GoalEvidenceKind, GoalInput, GoalState } from '../../src/runtime/goal/types.js';
export type { CompoundExecutionStatus } from '../../src/runtime/sol-pi/compound-status.js';
export type { SemanticCompactionStatus } from '../../src/runtime/sol-pi/semantic-status.js';
