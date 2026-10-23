import {validateCompoundOperationLedger,type CompoundOperationLedger,type CompoundStepStatus} from './compound-operation.js';
/** Read-only main-owned view. Never an execution or recovery capability. */
export interface CompoundExecutionStatus {
 mode:'mechanism-experiment';
 edit:CompoundStepStatus;validation:CompoundStepStatus;
 pendingOperations:number;unknownOperations:number;completedOperations:number;
}
export function describeCompoundExecutionStatus(value:CompoundOperationLedger|undefined):CompoundExecutionStatus{
 const ledger=value?validateCompoundOperationLedger(value):undefined;
 const last=ledger?.operations.at(-1),all=[...(ledger?.operations??[]),...(ledger?.directOperations??[])];
 return {mode:'mechanism-experiment',edit:last?.editStatus??'not_started',validation:last?.validation.status??'not_started',
  pendingOperations:all.filter(r=>!['settled','outcome_unknown'].includes(r.stage)).length,
  unknownOperations:all.filter(r=>r.stage==='outcome_unknown').length,
  completedOperations:all.filter(r=>r.stage==='settled').length};
}
