import type {PublishedArtifactSelection} from '../../src/runtime/verification/published-artifact-selection.js';
/** Content identity and dated observations only; never reusable verification authority. */
export interface LoopArtifactIdentity {runId:string;candidateId:string;candidateRevision:number;payloadHash:string}
export interface LoopArtifactPageRequest {offset:number;identity:LoopArtifactIdentity|null}
export interface LoopArtifactPage {identity:LoopArtifactIdentity;offset:number;total:number;nextOffset:number|null;items:readonly {selection:Readonly<PublishedArtifactSelection>;path:string;sha256:string;size:number}[]}
export interface LoopArtifactListView extends LoopArtifactPage {loopId:string;checkedAt:number}

/** A selected content identity only. Main obtains fresh publication before use. */
export interface LoopArtifactExportSelection {
 identity:LoopArtifactIdentity;
 descriptor:{selection:Readonly<PublishedArtifactSelection>;sha256:string;size:number};
}
