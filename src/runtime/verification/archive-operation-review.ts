import {canonicalVerificationJson as json} from './protocol.js';
import type {VerificationOwner} from './proof-authority.js';
import type {QuiescenceExpectation} from '../isolated-execution/physical-quiescence.js';
export type ArchiveResourceReview={kind:'transcript';resourceId:string;manifestHash:string;expected:QuiescenceExpectation;complete:boolean;truncated:boolean;stdout:{size:number;sha256:string};stderr:{size:number;sha256:string}}|{kind:'protected-run';sourceRunId:string;runNonce:string;rootInvocation:Pick<QuiescenceExpectation,'sessionIdentity'|'compoundOperationId'|'validationInvocationId'>;state:'sealed'|'prepared'|'complete'|'deleted';archiveHash:string|null;archiveBytes:number|null;memberCount:number;censusHash:string};
export interface ArchiveOperationReview {version:1;purpose:'execution-archive-access';authorityId:string;challengeId:string;principal:{uid:number;accountGeneration:string;auditSessionId:number};requestSource:'user';action:'read'|'delete';owner:VerificationOwner;resource:ArchiveResourceReview;deadline:{domainId:string;qualificationEpoch:number;notBefore:number;validUntil:number}}
function shape(v:unknown,keys:string[]):asserts v is Record<string,any>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==keys.sort().join(','))throw Error('archive_review_shape');}
function id(v:unknown){if(typeof v!=='string'||!v||Buffer.byteLength(v)>160||/[\x00-\x1f\x7f]/.test(v))throw Error('archive_review_identity');}
function integer(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER){if(!Number.isSafeInteger(v)||(v as number)<min||(v as number)>max)throw Error('archive_review_number');}
function hash(v:unknown){if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))throw Error('archive_review_hash');}
function uuid(v:unknown){if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))throw Error('archive_review_resource');}
function freeze<T>(v:T):T{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
function ascii(v:unknown){return Buffer.from(json(v).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')));}
function validateResource(s:any,action:'read'|'delete'){
 if(s?.kind==='transcript'){
  shape(s,['kind','resourceId','manifestHash','expected','complete','truncated','stdout','stderr']);uuid(s.resourceId);hash(s.manifestHash);shape(s.expected,['sessionIdentity','compoundOperationId','validationInvocationId','executionIdentity','scopeDigest']);for(const k of ['sessionIdentity','compoundOperationId','validationInvocationId','executionIdentity'])id(s.expected[k]);hash(s.expected.scopeDigest);
  if(typeof s.complete!=='boolean'||typeof s.truncated!=='boolean'||s.complete&&s.truncated)throw Error('archive_review_capture');for(const k of ['stdout','stderr']){shape(s[k],['size','sha256']);integer(s[k].size,0,4*1024**2);hash(s[k].sha256);}if(s.stdout.size+s.stderr.size>4*1024**2)throw Error('archive_review_capture_limit');
 }else{
  shape(s,['kind','sourceRunId','runNonce','rootInvocation','state','archiveHash','archiveBytes','memberCount','censusHash']);if(s.kind!=='protected-run'||!['sealed','prepared','complete','deleted'].includes(s.state))throw Error('archive_review_run');uuid(s.sourceRunId);uuid(s.runNonce);hash(s.censusHash);integer(s.memberCount,0,65536);shape(s.rootInvocation,['sessionIdentity','compoundOperationId','validationInvocationId']);Object.values(s.rootInvocation).forEach(id);
  if(s.archiveHash===null||s.archiveBytes===null){if(s.archiveHash!==null||s.archiveBytes!==null||!['sealed','deleted'].includes(s.state))throw Error('archive_review_archive');}else{hash(s.archiveHash);integer(s.archiveBytes,0,16*1024**2);}if(action==='read'&&(s.state!=='complete'||s.archiveHash===null))throw Error('archive_review_incomplete');
 }
}
/** Pure response validation; this does not issue authority or a capability. */
export function parseArchiveReadResource(raw:unknown):Readonly<ArchiveResourceReview>{const serialized=json(raw);if(Buffer.byteLength(serialized)>65536)throw Error('archive_review_limit');const resource=JSON.parse(serialized);validateResource(resource,'read');return freeze(resource);}
/** Pure deletion descriptor validation; this does not authorize deletion. */
export function parseArchiveDeleteResource(raw:unknown):Readonly<ArchiveResourceReview>{const serialized=json(raw);if(Buffer.byteLength(serialized)>65536)throw Error('archive_review_limit');const resource=JSON.parse(serialized);validateResource(resource,'delete');return freeze(resource);}
/** Pure exact review validation; a parsed review and hash grant no access. */
export function parseArchiveOperationReview(raw:unknown):Readonly<ArchiveOperationReview>{
 const serialized=json(raw);if(Buffer.byteLength(serialized)>65536||ascii(raw).length>65536)throw Error('archive_review_limit');const r=JSON.parse(serialized);
 shape(r,['version','purpose','authorityId','challengeId','principal','requestSource','action','owner','resource','deadline']);if(r.version!==1||r.purpose!=='execution-archive-access'||r.requestSource!=='user'||!['read','delete'].includes(r.action))throw Error('archive_review_purpose');id(r.authorityId);id(r.challengeId);
 shape(r.principal,['uid','accountGeneration','auditSessionId']);integer(r.principal.uid,1,0xfffffffe);integer(r.principal.auditSessionId,1,0xfffffffe);if(typeof r.principal.accountGeneration!=='string'||!/^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/.test(r.principal.accountGeneration))throw Error('archive_review_principal');
 shape(r.owner,['profileId','ownerKind','ownerId']);id(r.owner.profileId);id(r.owner.ownerId);if(!['task','goal','intent','project','loop'].includes(r.owner.ownerKind))throw Error('archive_review_owner');
 validateResource(r.resource,r.action);
 shape(r.deadline,['domainId','qualificationEpoch','notBefore','validUntil']);id(r.deadline.domainId);integer(r.deadline.qualificationEpoch);integer(r.deadline.notBefore);integer(r.deadline.validUntil);if(r.deadline.validUntil<=r.deadline.notBefore||r.deadline.validUntil-r.deadline.notBefore>300000)throw Error('archive_review_deadline');return freeze(r) as Readonly<ArchiveOperationReview>;
}
export function archiveReviewBytes(raw:unknown):Buffer{return ascii(parseArchiveOperationReview(raw));}
