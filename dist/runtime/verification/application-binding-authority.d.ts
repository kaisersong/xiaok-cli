import type { Database } from 'better-sqlite3';
import type { VerificationOwner } from './proof-authority.js';
import { type createVerificationCompletionComposition } from './completion-composition.js';
import { type ApplicationBindingReview } from './application-binding-review.js';
import { type BusinessApplicationBinding } from './business-application-binding.js';
import type { ControllerPeer } from './controller-public-daemon.js';
import type { ReceiverClockEvidence } from './receiver-store.js';
type Source = 'user' | 'agent' | 'scheduler';
type Principal = ControllerPeer & {
    accountGeneration: string;
    source: 'macos-local-generateduid';
};
type Phase = 'prepared' | 'authorizing' | 'approved' | 'committed' | 'failed' | 'retired' | 'not_approved';
interface RequestResult {
    state: 'absent' | 'not_prepared' | 'not_approved' | 'pending' | 'reauthorization_required' | 'registration_changed' | 'committed';
    challengePhase?: Phase;
    challenge?: Readonly<{
        challengeId: string;
        canonicalReview: Readonly<ApplicationBindingReview>;
        alreadyCommitted: boolean;
    }>;
    observation?: ReturnType<typeof inspectApplicationValue>;
}
declare function inspectApplicationValue(host: ReturnType<typeof createVerificationCompletionComposition>['privateHost'], db: Database, owner: Readonly<VerificationOwner>): Readonly<{
    pendingTarget: Readonly<BusinessApplicationBinding> | null;
    state: "unbound" | "pending" | "active";
    current: Readonly<import("./business-application-binding.js").ActiveBusinessApplicationBinding> | null;
    pendingTransitionId: string | null;
}>;
/** Native binding coordinator over the original completion database. A parsed
 * review or public observation never substitutes this private composition. */
export declare function createApplicationBindingAuthority(input: {
    database: Database;
    authorityId: string;
    completion: ReturnType<typeof createVerificationCompletionComposition>;
    clock(): ReceiverClockEvidence;
    assertCurrent(): void;
    resolvePrincipal(peer: ControllerPeer): Principal;
    approve(review: Readonly<ApplicationBindingReview>, signal: AbortSignal): Promise<{
        uid: number;
        auditSessionId: number;
        reviewHash: string;
    }>;
}): Readonly<{
    prepare(raw: {
        requestSource: Source;
        binding: Readonly<BusinessApplicationBinding>;
    }, rawPeer: ControllerPeer): Readonly<{
        challengeId: string;
        canonicalReview: Readonly<ApplicationBindingReview>;
        alreadyCommitted: true;
    }> | Readonly<{
        challengeId: `${string}-${string}-${string}-${string}-${string}`;
        canonicalReview: Readonly<ApplicationBindingReview>;
        alreadyCommitted: false;
    }>;
    prepareRequest(raw: {
        requestSource: Source;
        requestId: string;
        binding: Readonly<BusinessApplicationBinding>;
    }, rawPeer: ControllerPeer): Readonly<{
        created: false;
        challenge: Readonly<{
            challengeId: string;
            canonicalReview: Readonly<ApplicationBindingReview>;
            alreadyCommitted: boolean;
        }>;
    }> | Readonly<{
        created: true;
        challenge: Readonly<{
            challengeId: string;
            canonicalReview: Readonly<ApplicationBindingReview>;
            alreadyCommitted: true;
        }> | Readonly<{
            challengeId: `${string}-${string}-${string}-${string}-${string}`;
            canonicalReview: Readonly<ApplicationBindingReview>;
            alreadyCommitted: false;
        }>;
    }>;
    lookupRequest(raw: {
        requestSource: Source;
        requestId: string;
        binding: Readonly<BusinessApplicationBinding>;
    }, rawPeer: ControllerPeer): RequestResult;
    recoverRequest(raw: {
        requestSource: Source;
        requestId: string;
        binding: Readonly<BusinessApplicationBinding>;
    }, rawPeer: ControllerPeer): RequestResult;
    authorize(raw: {
        requestSource: Source;
        challengeId: string;
    }, rawPeer: ControllerPeer, signal: AbortSignal): Promise<import("./business-application-binding.js").BusinessApplicationObservation>;
    inspect(raw: {
        ownerKind: "goal" | "loop" | "intent";
        ownerId: string;
    }, rawPeer: ControllerPeer): Readonly<{
        pendingTarget: Readonly<BusinessApplicationBinding> | null;
        state: "unbound" | "pending" | "active";
        current: Readonly<import("./business-application-binding.js").ActiveBusinessApplicationBinding> | null;
        pendingTransitionId: string | null;
    }>;
    reconcile(raw: {
        requestSource: Source;
        challengeId: string;
    }, rawPeer: ControllerPeer): import("./business-application-binding.js").BusinessApplicationObservation;
    close(): void;
}>;
export {};
