import type {LoopDatabaseSource} from './loop-database-owner.js';

declare const metadataPermitBrand:unique symbol;
/** Issued only by the actual installed Main bridge. Shape/copy is not authority. */
export interface MetadataWritePermit {readonly [metadataPermitBrand]:true}
export type LoopMetadataWriteRequest =
 | Readonly<{source:LoopDatabaseSource;operation:'loop-export-prepare';subject:Readonly<{candidateId:string;expectedCandidateRevision:number}>}>
 | Readonly<{source:LoopDatabaseSource;operation:'loop-export-advance';subject:Readonly<{exportId:string;expectedRevision:number}>}>;
/** Contract only: this module intentionally has no issuer or permissive fallback.
 * The production factory must bind actual custody, the original shared ledger,
 * complete retained session attribution and the actual source's usable cap. */
export interface InstalledLoopMetadataBridge {
 prepareWrite(request:LoopMetadataWriteRequest):Promise<MetadataWritePermit>;
 /** Private fixed Main writer; consumes the permit before invoking synchronous
  * work. The actual implementation rejects thenables and restores no used ticket. */
 withWrite<T>(permit:MetadataWritePermit,write:()=>T):T;
 close():Promise<void>;
}
