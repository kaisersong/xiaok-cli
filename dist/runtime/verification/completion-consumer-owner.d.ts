import type { VerificationOwner } from './proof-authority.js';
/** Shared enrollment/read/publication identity mapping. Original loop IDs retain
 * their exact bytes and kind; no trim, case folding, or metadata fallback. */
export declare function completionConsumerOwner(raw: {
    ownerKind: 'task' | 'intent' | 'goal' | 'project' | 'loop_stage' | 'loop_run';
    ownerId: string;
}): Pick<VerificationOwner, 'ownerKind' | 'ownerId'>;
