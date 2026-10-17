import { type CurrentCompletionState } from './completion-client.js';
import type { VerificationOwner } from './proof-authority.js';
type OwnerIdentity = Pick<VerificationOwner, 'ownerKind' | 'ownerId'>;
export type InstalledCompletionObservation = {
    kind: 'ordinary';
} | {
    kind: 'unavailable';
} | {
    kind: 'protected';
    state: Readonly<CurrentCompletionState>;
};
/** Fresh display/evidence observation only. This result is never authorization to
 * write a protected completion: settlement and receiver commit remain required. */
export declare function observeInstalledCompletionSync(owner: OwnerIdentity): Readonly<InstalledCompletionObservation>;
export declare function observeInstalledCompletion(owner: OwnerIdentity, signal?: AbortSignal): Promise<Readonly<InstalledCompletionObservation>>;
export {};
