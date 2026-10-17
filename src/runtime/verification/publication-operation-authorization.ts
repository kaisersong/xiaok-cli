import {createHash} from 'node:crypto';
import {parsePublicationOperationReview,publicationReviewBytes} from './publication-operation-review.js';
import type {ReceiverClockEvidence} from './receiver-store.js';
/** Private root-broker operation. Callbacks are installed native ports, never RPC
 * inputs. The returned native fact is not a public publication or mutation grant. */
export async function authorizePublicationOperation(raw:unknown,options:{authorityId:string;allowedUserIds:readonly number[];signal:AbortSignal;clock():Readonly<ReceiverClockEvidence>;resolveAccount(uid:number,signal:AbortSignal):Promise<string>;approve(input:{uid:number;auditSessionId:number;reviewBytes:Buffer;continuousDeadlineMs:number},signal:AbortSignal):Promise<string>}){
 const {authorityId,signal,clock,resolveAccount,approve}=options,allowed=new Set(options.allowedUserIds),review=parsePublicationOperationReview(raw);
 if(review.authorityId!==authorityId||!allowed.has(review.principal.uid))throw Error('publication_authority');
 const bytes=publicationReviewBytes(review),reviewHash=createHash('sha256').update(bytes).digest('hex');
 function deadline(){signal.throwIfAborted();const sample=clock(),d=review.deadline;if(!sample||sample.domainId!==d.domainId||sample.qualificationEpoch!==d.qualificationEpoch||!Number.isSafeInteger(sample.lowerBound)||!Number.isSafeInteger(sample.upperBound)||sample.lowerBound>d.validUntil||sample.upperBound<sample.lowerBound||sample.lowerBound<d.notBefore||sample.upperBound>=d.validUntil)throw Error('publication_deadline');}
 async function current(){deadline();const generation=await resolveAccount(review.principal.uid,signal);deadline();if(generation!==review.principal.accountGeneration)throw Error('publication_account_changed');}
 await current();const result=await approve({uid:review.principal.uid,auditSessionId:review.principal.auditSessionId,reviewBytes:Buffer.from(bytes),continuousDeadlineMs:review.deadline.validUntil},signal);await current();if(result!==reviewHash)throw Error('publication_approval_unknown');
 return Object.freeze({version:1 as const,purpose:'completion-publication' as const,authorityId:review.authorityId,challengeId:review.challengeId,uid:review.principal.uid,accountGeneration:review.principal.accountGeneration,auditSessionId:review.principal.auditSessionId,requestSource:review.requestSource,fullReviewHash:reviewHash});
}
