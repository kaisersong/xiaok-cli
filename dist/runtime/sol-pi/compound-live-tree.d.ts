import { type SemanticSummaryProviderScope } from './semantic-summary-attempt.js';
import type { SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
import { type StoredSessionSnapshot } from '../../ai/runtime/session-store/store.js';
import type { CompoundTreeOwner } from './compound-child-installation.js';
/** Synchronous canonical census under the shared root lease. The callback must
 * authenticate actual private issuers; disk "live" fields alone are not enough. */
export declare function inspectCompoundLiveTree(input: {
    treeRoot: CompoundTreeOwner;
    lease: SessionExecutionLease;
    candidate?: StoredSessionSnapshot;
    semanticScope?: SemanticSummaryProviderScope;
    assertLive(snapshot: StoredSessionSnapshot): void;
}): Readonly<{
    sessionIds: readonly string[];
}>;
