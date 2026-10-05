import { type CompoundOperationLedger, type CompoundStepStatus } from './compound-operation.js';
/** Read-only main-owned view. Never an execution or recovery capability. */
export interface CompoundExecutionStatus {
    mode: 'mechanism-experiment';
    edit: CompoundStepStatus;
    validation: CompoundStepStatus;
    pendingOperations: number;
    unknownOperations: number;
    completedOperations: number;
}
export declare function describeCompoundExecutionStatus(value: CompoundOperationLedger | undefined): CompoundExecutionStatus;
