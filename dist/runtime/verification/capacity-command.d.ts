import type { BlobReservationProposal } from './blob-budget.js';
/** A command is issued only by its original resource owner. No public command
 * constructor or callback-bearing payload exists. */
export interface PreparedCapacityCommand {
    readonly __preparedCapacityCommand?: never;
}
export interface CapacityWriteContext {
    readonly __capacityWriteContext?: never;
}
export interface PreparedCapacityCommandFacts {
    readonly allocations: readonly Readonly<BlobReservationProposal>[];
    readonly capacityBinding: object | undefined;
}
