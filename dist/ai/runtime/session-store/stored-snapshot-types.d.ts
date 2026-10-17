import type { PersistedSessionSnapshot } from './store.js';
import type { NormalizedStoredSessionIntentLedger, StoredSessionIntentLedgerInput } from '../../../runtime/intent-delegation/stored-intent-clone.js';
export type StoredSessionSnapshot = Omit<PersistedSessionSnapshot, 'intentDelegation'> & {
    intentDelegation?: StoredSessionIntentLedgerInput | NormalizedStoredSessionIntentLedger;
};
