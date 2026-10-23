import { type ApplicationBindingReview } from './application-binding-review.js';
import { type LoopApplicationBinding } from './loop-application-binding.js';
import { type ActiveLoopApplicationBinding } from './business-application-binding.js';
export interface LoopApplicationObservation {
    readonly state: 'unbound' | 'pending' | 'active';
    readonly current: Readonly<ActiveLoopApplicationBinding> | null;
    readonly pendingTransitionId: string | null;
}
export interface LoopApplicationChallenge {
    readonly challengeId: string;
    readonly canonicalReview: Readonly<ApplicationBindingReview>;
    readonly alreadyCommitted: boolean;
}
export interface InstalledLoopApplicationObservation extends LoopApplicationObservation {
    readonly pendingTarget?: Readonly<LoopApplicationBinding> | null;
}
export interface LoopApplicationRequestObservation {
    readonly state: 'absent' | 'not_prepared' | 'not_approved' | 'pending' | 'reauthorization_required' | 'registration_changed' | 'committed';
    readonly challengePhase?: 'prepared' | 'authorizing' | 'approved' | 'committed' | 'failed' | 'retired' | 'not_approved';
    readonly challenge?: Readonly<LoopApplicationChallenge>;
    readonly observation?: Readonly<InstalledLoopApplicationObservation>;
}
/** Fixed machine endpoint and current OS owner. Restart records allow only
 * reconciliation; only the original prepared object can initiate native review. */
export declare function createInstalledLoopApplicationClient(raw: Readonly<LoopApplicationBinding>, requestSource: 'user' | 'agent' | 'scheduler'): Readonly<{
    prepareRequest(id: string, signal?: AbortSignal): Promise<Readonly<{
        created: boolean;
        challenge: Readonly<LoopApplicationChallenge>;
    }>>;
    lookupRequest(id: string, signal?: AbortSignal): Promise<Readonly<LoopApplicationRequestObservation>>;
    recoverRequest(id: string, signal?: AbortSignal): Promise<Readonly<LoopApplicationRequestObservation>>;
    inspect(signal?: AbortSignal): Promise<Readonly<InstalledLoopApplicationObservation>>;
    prepare(signal?: AbortSignal): Promise<Readonly<LoopApplicationChallenge>>;
    authorize(record: Readonly<LoopApplicationChallenge>, signal?: AbortSignal): Promise<Readonly<InstalledLoopApplicationObservation>>;
    reconcile(record: Readonly<LoopApplicationChallenge>, signal?: AbortSignal): Promise<Readonly<InstalledLoopApplicationObservation>>;
    dispose(): void;
}>;
