import { type ApplicationBindingReview } from './application-binding-review.js';
import { type GoalApplicationBinding, type GoalApplicationObservation } from './goal-application-binding.js';
export interface GoalApplicationChallenge {
    readonly challengeId: string;
    readonly canonicalReview: Readonly<ApplicationBindingReview>;
    readonly alreadyCommitted: boolean;
}
export interface InstalledGoalApplicationObservation extends GoalApplicationObservation {
    readonly pendingTarget?: Readonly<GoalApplicationBinding> | null;
}
export interface GoalApplicationRequestObservation {
    readonly state: 'absent' | 'not_prepared' | 'not_approved' | 'pending' | 'reauthorization_required' | 'registration_changed' | 'committed';
    readonly challengePhase?: 'prepared' | 'authorizing' | 'approved' | 'committed' | 'failed' | 'retired' | 'not_approved';
    readonly challenge?: Readonly<GoalApplicationChallenge>;
    readonly observation?: Readonly<InstalledGoalApplicationObservation>;
}
/** Fixed machine endpoint and current OS owner. Restart records allow only
 * reconciliation; only the original prepared object can initiate native review. */
export declare function createInstalledGoalApplicationClient(raw: Readonly<GoalApplicationBinding>, requestSource: 'user' | 'agent' | 'scheduler'): Readonly<{
    prepareRequest(id: string, signal?: AbortSignal): Promise<Readonly<{
        created: boolean;
        challenge: Readonly<GoalApplicationChallenge>;
    }>>;
    lookupRequest(id: string, signal?: AbortSignal): Promise<Readonly<GoalApplicationRequestObservation>>;
    recoverRequest(id: string, signal?: AbortSignal): Promise<Readonly<GoalApplicationRequestObservation>>;
    inspect(signal?: AbortSignal): Promise<Readonly<InstalledGoalApplicationObservation>>;
    prepare(signal?: AbortSignal): Promise<Readonly<GoalApplicationChallenge>>;
    authorize(record: Readonly<GoalApplicationChallenge>, signal?: AbortSignal): Promise<Readonly<InstalledGoalApplicationObservation>>;
    reconcile(record: Readonly<GoalApplicationChallenge>, signal?: AbortSignal): Promise<Readonly<InstalledGoalApplicationObservation>>;
    dispose(): void;
}>;
