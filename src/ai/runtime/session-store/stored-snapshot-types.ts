import type { PersistedSessionSnapshot } from './store.js';
import type {
  NormalizedStoredSessionIntentLedger,
  StoredSessionIntentLedgerInput,
} from '../../../runtime/intent-delegation/stored-intent-clone.js';

// A2: this is a storage view, not a modern execution or authority assertion.
// File may return its existing ordinary clone; SQLite may return its existing raw JSON shape.
export type StoredSessionSnapshot = Omit<PersistedSessionSnapshot, 'intentDelegation'> & {
  intentDelegation?: StoredSessionIntentLedgerInput | NormalizedStoredSessionIntentLedger;
};
