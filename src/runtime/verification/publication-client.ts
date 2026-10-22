import {createHash} from 'node:crypto';
import type {createAuthenticatedControllerClient} from './controller-client.js';
import type {VerificationOwner} from './proof-authority.js';
import {canonicalVerificationJson as json} from './protocol.js';
import type {PublicationOperationReview} from './publication-operation-review.js';
export type PublicationSource='user'|'agent'|'scheduler';
export interface PublicationChallenge {readonly challengeId:string;readonly owner:VerificationOwner;readonly fullTupleHash:string;readonly deadline:PublicationOperationReview['deadline']}
export interface PublicationObservation {readonly status:'committed'|'cancelled'|'unknown';readonly owner:VerificationOwner;readonly operationId:string;readonly fullTupleHash:string;readonly businessRevision:number;readonly currentVerification:'valid'|'needs_revalidation'|'unavailable'}
export interface UnapprovedPublicationRecovery {readonly status:'not_approved'|'settlement_exists';readonly owner:VerificationOwner;readonly challengeId:string;readonly operationId:string;readonly fullTupleHash:string}
export type PublicationRequestRecovery = Readonly<{status:'not_prepared'}> | Readonly<UnapprovedPublicationRecovery & {challenge:Readonly<PublicationChallenge>}>;
export interface PublishedPayload {readonly owner:VerificationOwner;readonly businessRevision:number;readonly operationId:string;readonly fullTupleHash:string;readonly payloadHash:string;readonly bytes:Buffer}
export interface OwnerPublicationObservation {readonly owner:VerificationOwner;readonly businessRevision:number;readonly currentVerification:'valid'|'needs_revalidation'|'unavailable';readonly publication:Readonly<{status:'absent'}>|Readonly<{status:'committed'|'cancelled'|'unknown';current:boolean;operationId:string;fullTupleHash:string}>}
function snapshot(raw:unknown,keys:string[]):Record<string,any>{const v=JSON.parse(json(raw));if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==keys.sort().join(','))throw Error('publication_client_shape');return v;}
function id(v:unknown){if(typeof v!=='string'||!v||Buffer.byteLength(v)>160||/[\x00-\x1f\x7f]/.test(v))throw Error('publication_client_identity');}
function owner(raw:VerificationOwner){const v=snapshot(raw,['profileId','ownerKind','ownerId']);id(v.profileId);id(v.ownerId);if(!['task','intent','goal','loop','project'].includes(v.ownerKind))throw Error('publication_client_owner');return Object.freeze(v) as Readonly<VerificationOwner>;}
export function parsePublicationChallenge(raw:unknown,boundOwner:VerificationOwner):Readonly<PublicationChallenge>{boundOwner=owner(boundOwner);const v=snapshot(raw,['challengeId','owner','fullTupleHash','deadline']);id(v.challengeId);if(json(owner(v.owner))!==json(boundOwner)||!/^[a-f0-9]{64}$/.test(v.fullTupleHash))throw Error('publication_client_binding');const d=snapshot(v.deadline,['domainId','qualificationEpoch','notBefore','validUntil']);id(d.domainId);if(![d.qualificationEpoch,d.notBefore,d.validUntil].every(Number.isSafeInteger)||d.qualificationEpoch<0||d.notBefore<0||d.validUntil<=d.notBefore||d.validUntil-d.notBefore>300000)throw Error('publication_client_deadline');return Object.freeze({...v,owner:boundOwner,deadline:Object.freeze(d)}) as Readonly<PublicationChallenge>;}
export function parsePublicationObservation(raw:unknown,original:Readonly<PublicationChallenge>,boundOwner:VerificationOwner):Readonly<PublicationObservation>{boundOwner=owner(boundOwner);const v=snapshot(raw,['status','owner','operationId','fullTupleHash','businessRevision','currentVerification']);id(v.operationId);if(json(owner(v.owner))!==json(boundOwner)||v.fullTupleHash!==original.fullTupleHash||!['committed','cancelled','unknown'].includes(v.status)||!['valid','needs_revalidation','unavailable'].includes(v.currentVerification)||!Number.isSafeInteger(v.businessRevision)||v.businessRevision<1)throw Error('publication_client_binding');return Object.freeze({...v,owner:boundOwner}) as Readonly<PublicationObservation>;}

/** Signed transport client. Results are observations, never local write grants.
 * Only the original prepared object can request its one native approval. */
export function createPublicationClient(input:{owner:VerificationOwner;requestSource:PublicationSource;transport:ReturnType<typeof createAuthenticatedControllerClient>['publicationTransport']}){
 const boundOwner=owner(input.owner),source=input.requestSource,call=input.transport.call.bind(input.transport),pending=new WeakSet<object>();
 if(!['user','agent','scheduler'].includes(source))throw Error('publication_client_source');
 const challenge=(raw:unknown)=>parsePublicationChallenge(raw,boundOwner);
 const observation=(raw:unknown,original:Readonly<PublicationChallenge>)=>parsePublicationObservation(raw,original,boundOwner);
 function ownerObservation(raw:unknown):Readonly<OwnerPublicationObservation>{
  const v=snapshot(raw,['owner','businessRevision','currentVerification','publication']);
  if(json(owner(v.owner))!==json(boundOwner)||!Number.isSafeInteger(v.businessRevision)||v.businessRevision<0||!['valid','needs_revalidation','unavailable'].includes(v.currentVerification))throw Error('publication_client_binding');
  const p=snapshot(v.publication,v.publication?.status==='absent'?['status']:['status','current','operationId','fullTupleHash']);
  if(p.status!=='absent'){id(p.operationId);if(!['committed','cancelled','unknown'].includes(p.status)||typeof p.current!=='boolean'||!/^[a-f0-9]{64}$/.test(p.fullTupleHash)||(p.current&&(p.status!=='committed'||v.currentVerification!=='valid')))throw Error('publication_client_binding');}
  return Object.freeze({...v,owner:boundOwner,publication:Object.freeze(p)}) as Readonly<OwnerPublicationObservation>;
 }
 async function readPayload(raw:Readonly<OwnerPublicationObservation>,signal?:AbortSignal):Promise<Readonly<PublishedPayload>>{
  return consumePayload(ownerObservation(raw),signal);
 }
 async function consumePayload(expected:Readonly<OwnerPublicationObservation>,signal?:AbortSignal,firstPage?:{page:unknown}):Promise<Readonly<PublishedPayload>>{
  const publication=expected.publication;
  if(publication.status!=='committed'||!publication.current)throw Error('publication_client_not_current');
  let offset=0,total:number|undefined,payloadHash:string|undefined;const chunks:Buffer[]=[];
  do{
   signal?.throwIfAborted();
   const page=snapshot(firstPage?firstPage.page:await call('publication.readOwnerPayload',{ownerKind:boundOwner.ownerKind,ownerId:boundOwner.ownerId,operationId:publication.operationId,fullTupleHash:publication.fullTupleHash,offset,maxBytes:262144},signal),['owner','businessRevision','operationId','fullTupleHash','payloadHash','totalBytes','offset','bytes','eof']);
   firstPage=undefined;
   if(json(owner(page.owner))!==json(boundOwner)||page.businessRevision!==expected.businessRevision||page.operationId!==publication.operationId||page.fullTupleHash!==publication.fullTupleHash||!Number.isSafeInteger(page.totalBytes)||page.totalBytes<1||page.totalBytes>32*1024**2||typeof page.payloadHash!=='string'||!/^[a-f0-9]{64}$/.test(page.payloadHash)||page.offset!==offset||typeof page.bytes!=='string'||page.bytes.length>349528||typeof page.eof!=='boolean')throw Error('publication_client_payload_page');
   if(total!==undefined&&(total!==page.totalBytes||payloadHash!==page.payloadHash))throw Error('publication_client_payload_changed');
   total=page.totalBytes;payloadHash=page.payloadHash;
   const bytes=Buffer.from(page.bytes,'base64');
   if(bytes.toString('base64')!==page.bytes||bytes.length>262144||offset+bytes.length>total!||page.eof!==(offset+bytes.length===total)||(!bytes.length&&!page.eof))throw Error('publication_client_payload_page');
   chunks.push(bytes);offset+=bytes.length;if(page.eof)break;
  }while(true);
  signal?.throwIfAborted();const bytes=Buffer.concat(chunks,offset);
  if(createHash('sha256').update(bytes).digest('hex')!==payloadHash)throw Error('publication_client_payload_hash');
  return Object.freeze({owner:boundOwner,businessRevision:expected.businessRevision,operationId:publication.operationId,fullTupleHash:publication.fullTupleHash,payloadHash:payloadHash!,bytes});
 }
 return Object.freeze({
  readPayload,
  async readCurrentPayload(signal?:AbortSignal){
   if(boundOwner.ownerKind!=='loop')throw Error('publication_client_owner');
   signal?.throwIfAborted();
   const result=snapshot(await call('publication.readCurrentOwnerPayload',{ownerKind:boundOwner.ownerKind,ownerId:boundOwner.ownerId},signal),['observation','page']),observed=ownerObservation(result.observation);
   signal?.throwIfAborted();
   if(observed.currentVerification!=='valid'||observed.publication.status!=='committed'||!observed.publication.current){if(result.page!==null)throw Error('publication_client_payload_page');return Object.freeze({observation:observed,payload:null});}
   if(result.page===null)throw Error('publication_client_payload_page');
   const payload=await consumePayload(observed,signal,{page:result.page});
   return Object.freeze({observation:observed,payload});
  },
  async prepareRequest(requestId:string,signal?:AbortSignal){id(requestId);const result=challenge(await call('publication.prepareRequest',{ownerKind:boundOwner.ownerKind,ownerId:boundOwner.ownerId,requestSource:source,requestId},signal));pending.add(result);return result;},
  async lookupRequest(requestId:string,signal?:AbortSignal){id(requestId);const raw=await call('publication.lookupRequest',{requestId},signal),v=snapshot(raw,['absent','not_prepared'].includes((raw as any)?.state)?['state']:['state','challenge']);if(v.state==='absent')return Object.freeze({state:'absent' as const});if(v.state==='not_prepared')return Object.freeze({state:'not_prepared' as const});if(v.state!=='prepared')throw Error('publication_client_request');return Object.freeze({state:'prepared' as const,challenge:challenge(v.challenge)});},
  async recoverRequest(requestId:string,signal?:AbortSignal):Promise<PublicationRequestRecovery>{id(requestId);const raw=await call('publication.recoverRequest',{ownerKind:boundOwner.ownerKind,ownerId:boundOwner.ownerId,requestSource:source,requestId},signal);const v=snapshot(raw,(raw as any)?.status==='not_prepared'?['status']:['status','owner','challengeId','operationId','fullTupleHash','challenge']);if(v.status==='not_prepared')return Object.freeze({status:'not_prepared'});const original=challenge(v.challenge);id(v.operationId);if(!['not_approved','settlement_exists'].includes(v.status)||json(owner(v.owner))!==json(boundOwner)||v.challengeId!==original.challengeId||v.fullTupleHash!==original.fullTupleHash)throw Error('publication_client_recovery');return Object.freeze({...v,owner:boundOwner,challenge:original}) as PublicationRequestRecovery;},
  async recoverUnapproved(record:Readonly<PublicationChallenge>,signal?:AbortSignal):Promise<Readonly<UnapprovedPublicationRecovery>>{const original=challenge(record),v=snapshot(await call('publication.recoverUnapproved',{challengeId:original.challengeId},signal),['status','owner','challengeId','operationId','fullTupleHash']);id(v.operationId);if(!['not_approved','settlement_exists'].includes(v.status)||json(owner(v.owner))!==json(boundOwner)||v.challengeId!==original.challengeId||v.fullTupleHash!==original.fullTupleHash)throw Error('publication_client_recovery');return Object.freeze({...v,owner:boundOwner}) as Readonly<UnapprovedPublicationRecovery>;},
  async observe(signal?:AbortSignal){return ownerObservation(await call('publication.observeOwner',{ownerKind:boundOwner.ownerKind,ownerId:boundOwner.ownerId},signal));},
  async prepare(signal?:AbortSignal){const result=challenge(await call('publication.prepare',{ownerKind:boundOwner.ownerKind,ownerId:boundOwner.ownerId,requestSource:source},signal));pending.add(result);return result;},
  async approve(ticket:Readonly<PublicationChallenge>,signal?:AbortSignal){if(!pending.has(ticket))throw Error('publication_client_challenge');pending.delete(ticket);const original=challenge(ticket);return observation(await call('publication.approve',{challengeId:original.challengeId},signal),original);},
  async recoverExpired(record:Readonly<PublicationChallenge>,signal?:AbortSignal){const original=challenge(record);return observation(await call('publication.recoverExpired',{challengeId:original.challengeId},signal),original);},
  // Restart recovery accepts persisted identity only for a read, never replaying approval/commit.
  async reconcile(record:Readonly<PublicationChallenge>,signal?:AbortSignal){const original=challenge(record);return observation(await call('publication.reconcile',{challengeId:original.challengeId},signal),original);},
 });
}
