import { type ApplicationBindingReview } from './application-binding-review.js';
import { type IntentApplicationBinding } from './intent-application-binding.js';
import { type ActiveIntentApplicationBinding } from './business-application-binding.js';
export interface IntentApplicationObservation {
    readonly state: 'unbound' | 'pending' | 'active';
    readonly current: Readonly<ActiveIntentApplicationBinding> | null;
    readonly pendingTransitionId: string | null;
}
export interface IntentApplicationChallenge {
    readonly challengeId: string;
    readonly canonicalReview: Readonly<ApplicationBindingReview>;
    readonly alreadyCommitted: boolean;
}
export interface InstalledIntentApplicationObservation extends IntentApplicationObservation {
    readonly pendingTarget?: Readonly<IntentApplicationBinding> | null;
}
export interface IntentApplicationRequestObservation {
    readonly state: 'absent' | 'not_prepared' | 'not_approved' | 'pending' | 'reauthorization_required' | 'registration_changed' | 'committed';
    readonly challengePhase?: 'prepared' | 'authorizing' | 'approved' | 'committed' | 'failed' | 'retired' | 'not_approved';
    readonly challenge?: Readonly<IntentApplicationChallenge>;
    readonly observation?: Readonly<InstalledIntentApplicationObservation>;
}
/** Fixed machine endpoint and current OS owner. Restart records allow only
 * reconciliation; only the original prepared object can initiate native review. */
export declare function createInstalledIntentApplicationClient(raw: Readonly<IntentApplicationBinding>, requestSource: 'user' | 'agent' | 'scheduler'): Readonly<{
    prepareRequest(id: string, signal?: AbortSignal): Promise<Readonly<{
        created: boolean;
        challenge: Readonly<IntentApplicationChallenge>;
    }>>;
    lookupRequest(id: string, signal?: AbortSignal): Promise<Readonly<IntentApplicationRequestObservation>>;
    recoverRequest(id: string, signal?: AbortSignal): Promise<Readonly<IntentApplicationRequestObservation>>;
    inspect(signal?: AbortSignal): Promise<Readonly<InstalledIntentApplicationObservation>>;
    prepare(signal?: AbortSignal): Promise<Readonly<IntentApplicationChallenge>>;
    authorize(record: Readonly<IntentApplicationChallenge>, signal?: AbortSignal): Promise<Readonly<InstalledIntentApplicationObservation>>;
    reconcile(record: Readonly<IntentApplicationChallenge>, signal?: AbortSignal): Promise<Readonly<InstalledIntentApplicationObservation>>;
    dispose(): void;
}>;
