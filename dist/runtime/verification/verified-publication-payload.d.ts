import { type IntentPublicationOwnerObservation } from './intent-parent-publication.js';
import { type KeyObject } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { createIndependentVerifierRecipes, RecipeEvaluation } from './independent-recipes.js';
import type { VerificationOwner } from './proof-authority.js';
import { type VerificationDependency, type VerificationTuple } from './protocol.js';
/** Private installed-controller composition. References and read results confer no ACL.
 * The exact connection is shared with proof/outbox. No caller bytes are accepted.
 */
export declare function createVerifiedPublicationPayloads(input: {
    database: Database;
    recipes: Pick<ReturnType<typeof createIndependentVerifierRecipes>, 'exportVerifiedArtifacts'>;
    proofAuthority?: {
        publicKey: KeyObject;
        issuerId: string;
        keyId: string;
        serviceEpoch: string;
        verifierHash: string;
    };
    inspectOwner?(owner: VerificationOwner): IntentPublicationOwnerObservation | undefined;
    assertPublicationTuplesCurrent?(tuples: readonly VerificationTuple[]): void;
    getCurrentDependencies(owner: VerificationOwner): readonly VerificationDependency[];
    assertCurrent(): void;
}): Readonly<{
    prepareRetention: (evaluation: RecipeEvaluation) => Readonly<{
        token: Readonly<{}>;
        bundleHash: string;
    }>;
    commitRetention: (token: object) => void;
    stage(raw: {
        owner: VerificationOwner;
        evaluations: readonly RecipeEvaluation[];
    }): Readonly<{
        payloadId: string;
        immutablePayloadHash: string;
        byteLength: number;
    }>;
    stageRetained(owner: VerificationOwner): Readonly<{
        payloadId: string;
        immutablePayloadHash: string;
        byteLength: number;
    }>;
    capture(payloadId: string, rawOwner: VerificationOwner): Readonly<{
        readBytes: () => Buffer<ArrayBuffer>;
        assertCurrent: () => void;
    }>;
    read(payloadId: string, rawOwner: VerificationOwner): Buffer;
    assertTuple(raw: VerificationTuple): void;
}>;
