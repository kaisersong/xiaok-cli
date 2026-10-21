import type { PersistedSessionSnapshot } from '../../ai/runtime/session-store/store.js';
import type { StoredSessionSnapshot } from '../../ai/runtime/session-store/stored-snapshot-types.js';
export declare function captureIntentSnapshot(snapshot: PersistedSessionSnapshot): PersistedSessionSnapshot;
export declare function captureIntentSnapshot(snapshot: StoredSessionSnapshot): StoredSessionSnapshot;
