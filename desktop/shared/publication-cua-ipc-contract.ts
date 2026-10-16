// Original semantic transport/public data contract; business and native authority unchanged.
import { GOAL_PROJECTION_OUTPUT } from './goal-projection-ipc-contract.js';
import { COMPUTER_USE_STATUS_SCHEMA } from './runtime-status-readonly-ipc-contract.js';
export const GOAL_PUBLICATION_OUTPUT = GOAL_PROJECTION_OUTPUT.nullable();
// Reuse reviewed full public four-field status, state remains string, optional lastError.
export const CUA_CONTROL_OUTPUT = COMPUTER_USE_STATUS_SCHEMA;
export const PUBLICATION_METHODS = ['recoverGoalPublication', 'continueGoalPublication'] as const;
export const CUA_CONTROL_METHODS = ['enableComputerUse', 'reconnectComputerUse', 'disableComputerUse'] as const;
