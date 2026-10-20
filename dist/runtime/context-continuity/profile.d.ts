export { readContinuityProfile } from './profile-identity.js';
export interface DesktopProfileIdentity {
    profileId: string;
    legacyProfileId?: string;
}
/** Read all authority stores before issuing an identity; a missing continuity DB proves nothing. */
export declare function resolveDesktopProfile(dataRoot: string): DesktopProfileIdentity;
/** A moved data root retains identity. Corruption/symlinks never cause silent adoption. */
export declare function loadContinuityProfile(dataRoot: string, options?: {
    requireExisting?: boolean;
}): string;
