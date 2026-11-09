import {createHash} from 'node:crypto';
import type {Entry} from './profile-source-custody-types.js';
import type {ProfileSourceDescriptor} from './profile-source-descriptor.js';
import type {startRootNmpCustodyProcess} from './root-nmp-custody-process.js';
/** Data comparison only; never a Source/custody/physical-known issuer. */
export function assertRootNmpReviewedIdentity(source:ProfileSourceDescriptor,h:Awaited<ReturnType<typeof startRootNmpCustodyProcess>>['header']):void{
 const f=h.facts;
 if(source.kind!=='sqlite-db'||h.directoryPath!==source.directory.canonicalPath||!Array.isArray(f)||f.length!==3||f.some(row=>!Array.isArray(row)||row.length!==5)||f[0]![0]!==source.directory.device||f[0]![1]!==source.directory.inode||f[2]![0]!==source.database.device||f[2]![1]!==source.database.inode||h.ledgerSha256!==source.reviewedSnapshotSha256)throw Error('source_custody_root_nmp_identity');
}
export function sliceRootNmpLedgerBytes(bytes:Buffer|undefined,offset:number,length:number):Buffer{
 if(!bytes||!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<1||length>256*1024||offset>bytes.length||length>bytes.length-offset)throw Error('source_custody_root_nmp_range');
 return Buffer.from(bytes.subarray(offset,offset+length));
}

export function physicalBody(e:Entry,files:unknown){return {version:1,manifestHash:createHash('sha256').update(e.manifest!).digest('hex'),reviewHash:e.receipt!.reviewHash,inventoryHash:e.review.inventoryHash,files};}

export function rootNmpCaptureReply(e:Entry){
 if(!e.rootNmp||!e.receipt||!e.handle)throw Error('source_custody_root_nmp_required');const h=e.rootNmp.header;
 return Object.freeze({handle:e.handle,reviewHash:e.receipt.reviewHash,inventoryHash:e.review.inventoryHash,byteCount:h.byteCount,sha256:h.sha256});
}
