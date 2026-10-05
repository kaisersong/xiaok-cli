import {canonicalVerificationJson,parseVerificationTuple,type VerificationTuple} from './protocol.js';
export interface PublicationOperationReview {
 version:1;purpose:'completion-publication';authorityId:string;challengeId:string;
 principal:{uid:number;accountGeneration:string;auditSessionId:number};requestSource:'user'|'agent'|'scheduler';tuple:VerificationTuple;
 deadline:{domainId:string;qualificationEpoch:number;notBefore:number;validUntil:number};
}
function shape(value:unknown,keys:string[]):asserts value is Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==keys.sort().join(','))throw Error('publication_review_shape');}
function id(v:unknown){if(typeof v!=='string'||!v||Buffer.byteLength(v)>160||/[\x00-\x1f\x7f]/.test(v))throw Error('publication_review_identifier');}
function integer(v:unknown,min=0){if(!Number.isSafeInteger(v)||(v as number)<min)throw Error('publication_review_number');}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function ascii(value:unknown){return Buffer.from(canonicalVerificationJson(value).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')));}
/** Pure validation only. Neither this object nor its hash grants publication. */
export function parsePublicationOperationReview(raw:unknown):Readonly<PublicationOperationReview>{
 const serialized=canonicalVerificationJson(raw);if(Buffer.byteLength(serialized)>1024**2+65536||ascii(raw).length>7*1024**2)throw Error('publication_review_limit');const r=JSON.parse(serialized);
 shape(r,['version','purpose','authorityId','challengeId','principal','requestSource','tuple','deadline']);
 if(r.version!==1||r.purpose!=='completion-publication'||!['user','agent','scheduler'].includes(r.requestSource))throw Error('publication_review_purpose');id(r.authorityId);id(r.challengeId);
 shape(r.principal,['uid','accountGeneration','auditSessionId']);integer(r.principal.uid,1);integer(r.principal.auditSessionId,1);if(r.principal.uid>=0xffffffff||r.principal.auditSessionId>0xffffffff||typeof r.principal.accountGeneration!=='string'||!/^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/.test(r.principal.accountGeneration))throw Error('publication_review_principal');
 r.tuple=parseVerificationTuple(r.tuple);shape(r.deadline,['domainId','qualificationEpoch','notBefore','validUntil']);id(r.deadline.domainId);integer(r.deadline.qualificationEpoch);integer(r.deadline.notBefore);integer(r.deadline.validUntil);
 const d=r.deadline,t=r.tuple;if(d.domainId!==t.clockDomainId||d.qualificationEpoch!==t.clockQualificationEpoch||d.notBefore<t.notBefore||d.validUntil>t.validUntil||d.validUntil<=d.notBefore||d.validUntil-d.notBefore>300000)throw Error('publication_review_deadline');
 return freeze(r) as Readonly<PublicationOperationReview>;
}
/** Exactly the immutable ASCII bytes displayed and hashed by the native helper. */
export function publicationReviewBytes(raw:unknown):Buffer{return ascii(parsePublicationOperationReview(raw));}
