import type { VerificationOwner } from './proof-authority.js';
export type PublishedArtifactSelection = {
    path: string;
    obligationId: string;
} & ({
    kind: 'local';
} | {
    kind: 'inherited';
    originOwner: VerificationOwner;
    originalObligationId: string;
});
export declare function assertPublishedArtifactOwner(value: unknown): asserts value is VerificationOwner;
export declare function assertPublishedArtifactPath(value: unknown): asserts value is string;
/** A content selector only, never a material/archive grant or a filesystem path. */
export declare function parsePublishedArtifactSelection(raw: unknown): Readonly<PublishedArtifactSelection>;
