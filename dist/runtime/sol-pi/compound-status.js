import { validateCompoundOperationLedger } from './compound-operation.js';
export function describeCompoundExecutionStatus(value) {
    const ledger = value ? validateCompoundOperationLedger(value) : undefined;
    const last = ledger?.operations.at(-1), all = [...(ledger?.operations ?? []), ...(ledger?.directOperations ?? [])];
    return { mode: 'mechanism-experiment', edit: last?.editStatus ?? 'not_started', validation: last?.validation.status ?? 'not_started',
        pendingOperations: all.filter(r => !['settled', 'outcome_unknown'].includes(r.stage)).length,
        unknownOperations: all.filter(r => r.stage === 'outcome_unknown').length,
        completedOperations: all.filter(r => r.stage === 'settled').length };
}
