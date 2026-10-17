import type { IntentArtifactSelection } from '../runtime/intent-delegation/publication-candidate-journal.js';
export type IntentPublicationCommand = {
    kind: 'draft' | 'status' | 'recover' | 'parent';
} | {
    kind: 'approve';
    path: string;
} | {
    kind: 'retry';
    candidateId: string;
};
export declare function parseIntentPublicationCommand(input: string): IntentPublicationCommand | null;
/** Explicit selectors only. Actual membership and original recipe paths are checked by the fixed host/store. */
export declare function readIntentPublicationSelectionFile(path: string): Readonly<{
    artifactSelections: IntentArtifactSelection[];
}>;
