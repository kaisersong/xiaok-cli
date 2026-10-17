import type {PersistedSessionSnapshot} from '../../ai/runtime/session-store/store.js';

/** Presence facts only. A false result does not prove modern data or grant execution. */
export interface IntentProtectedHistoryData {
  readonly nativeContracts?: unknown;
  readonly intents?: unknown;
  readonly latestPlan?: unknown;
}

// Only narrows property readability; no required field, producer shape or nominal identity.
function isHistoryObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

export function hasProtectedIntentProducerHistory(ledger: PersistedSessionSnapshot['intentDelegation']): boolean;
export function hasProtectedIntentProducerHistory(ledger: IntentProtectedHistoryData | null | undefined): boolean;
export function hasProtectedIntentProducerHistory(ledger: IntentProtectedHistoryData | null | undefined): boolean {
  const native = ledger?.nativeContracts;
  if (native !== undefined && native !== null) {
    if (!Array.isArray(native)) throw Error('intent_protected_history_native');
    if (native.length > 0) return true;
  }

  const sourceIntents = ledger?.intents;
  let intents: readonly unknown[] | null | undefined;
  if (sourceIntents === undefined || sourceIntents === null) intents = sourceIntents;
  else {
    if (!Array.isArray(sourceIntents)) throw Error('intent_protected_history_intents');
    intents = sourceIntents;
  }
  // The nullish-only empty list and the TWO latestPlan reads are the original semantics.
  const rows: readonly unknown[] = [...(intents ?? []), ...(ledger?.latestPlan ? [ledger.latestPlan] : [])];
  return rows.some(row => {
    if (!isHistoryObject(row)) throw Error('intent_protected_history_record');
    const reports = row.producerReports;
    if (reports === undefined || reports === null) return undefined;
    if (!Array.isArray(reports)) throw Error('intent_protected_history_reports');
    const values: readonly unknown[] = reports;
    return values.some(report => {
      if (!isHistoryObject(report)) throw Error('intent_protected_history_report');
      return report.protectionMode !== 'ordinary';
    });
  });
}
