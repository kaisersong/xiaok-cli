import { type PublishedArtifactSelection } from './published-artifact-selection.js';
import type { VerificationOwner } from './proof-authority.js';
/** Captured content only. This token grants no read, verification or mutation authority. */
export interface PublishedArtifactIndex {
    readonly opaquePublishedArtifactContentIndex: never;
}
type Entry = Readonly<{
    path: unknown;
    sha256: unknown;
    size: unknown;
    bytesBase64: unknown;
}>;
export declare function createPublishedArtifactIndex(payloadOwner: Readonly<VerificationOwner>, sections: readonly unknown[], selectedKeys: ReadonlySet<string>): PublishedArtifactIndex;
export declare function publishedArtifactPopulation(index: PublishedArtifactIndex): Readonly<{
    count: number;
    selectionBytes: number;
}>;
export declare function assertPublishedArtifactIndexOwner(index: PublishedArtifactIndex, owner: Readonly<VerificationOwner>): void;
export declare function publishedArtifactLookupKeys(applicationOwner: Readonly<VerificationOwner>, selection: Readonly<PublishedArtifactSelection>, allowLocalInheritance?: boolean): readonly string[];
export declare function findIndexedPublishedArtifacts(index: PublishedArtifactIndex, applicationOwner: Readonly<VerificationOwner>, selection: Readonly<PublishedArtifactSelection>, allowLocalInheritance?: boolean): readonly Entry[];
export declare function verifyIndexedPublishedArtifact(index: PublishedArtifactIndex, entry: Entry): void;
export declare function readIndexedPublishedArtifact(index: PublishedArtifactIndex, entry: Entry): Buffer;
export {};
