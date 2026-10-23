import type { PublishedPayload } from './publication-client.js';
import { type BusinessApplicationBinding } from './business-application-binding.js';
import { type PublishedArtifactSelection } from './published-artifact-selection.js';
export type { PublishedArtifactSelection } from './published-artifact-selection.js';
/** Content decoder only. A copied DTO or returned descriptor is never proof of
 * current verification and never authorizes a completion/store mutation.
 * No filesystem paths are resolved or opened. */
export declare function readPublishedArtifact(payload: Readonly<PublishedPayload>, rawSelection: PublishedArtifactSelection): any;
/** One bounded payload parse/index shared by all selected content and application checks. */
export declare function readPublishedArtifacts(payload: Readonly<PublishedPayload>, rawSelections: readonly PublishedArtifactSelection[], expectedRootBinding?: Readonly<BusinessApplicationBinding>): readonly any[];
