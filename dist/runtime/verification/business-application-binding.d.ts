import { type GoalApplicationBinding, type ActiveGoalApplicationBinding } from './goal-application-binding.js';
import { type LoopApplicationBinding } from './loop-application-binding.js';
import { type IntentApplicationBinding } from './intent-application-binding.js';
export type BusinessApplicationBinding = GoalApplicationBinding | LoopApplicationBinding | IntentApplicationBinding;
export interface ActiveLoopApplicationBinding {
    binding: Readonly<LoopApplicationBinding>;
    bindingHash: string;
    revision: number;
}
export interface ActiveIntentApplicationBinding {
    binding: Readonly<IntentApplicationBinding>;
    bindingHash: string;
    revision: number;
}
export type ActiveBusinessApplicationBinding = ActiveGoalApplicationBinding | ActiveLoopApplicationBinding | ActiveIntentApplicationBinding;
export interface BusinessApplicationObservation {
    state: 'unbound' | 'pending' | 'active';
    current: Readonly<ActiveBusinessApplicationBinding> | null;
    pendingTransitionId: string | null;
}
/** Strict closed union of business values, never an approval or projection. */
export declare function parseBusinessApplicationBinding(raw: unknown): Readonly<BusinessApplicationBinding>;
export declare function businessApplicationBindingHash(raw: unknown): string;
export declare function businessApplicationOwner(raw: unknown): Readonly<{
    ownerKind: "intent";
    ownerId: string;
}> | Pick<import("./proof-authority.js").VerificationOwner, "ownerId" | "ownerKind"> | Readonly<{
    ownerKind: "goal";
    ownerId: string;
}>;
export declare function businessApplicationEpoch(raw: unknown): number;
export declare function sameBusinessApplicationSubject(left: unknown, right: unknown): boolean;
export declare function parseActiveBusinessApplicationBinding(raw: unknown): Readonly<ActiveBusinessApplicationBinding>;
