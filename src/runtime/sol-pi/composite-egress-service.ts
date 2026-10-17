import type {RequestOptions} from 'node:https';
import {createHash,createPublicKey} from 'node:crypto';
import {createCompositeEgressJournal,type CompositeEgressAttempt} from './composite-egress-journal.js';
import {createCompositeParticipantVerifier,readCompositeParticipantReceipt,type CompositeParticipantIdentity} from './composite-participant-receipt.js';
import {createSingleRequestHttpsFetch} from './single-request-https.js';
export interface CompositeEgressTarget {destination:string;model:string;protocol:string;headers:Readonly<Record<string,string>>}
/** Normal one-attempt lifecycle. The installed composition supplies fixed targets
 * and registered participant identity; this does not issue a process-stop receipt. */
export function createCompositeEgressService(input:{root:string;egressId:string;generation:number;participant:CompositeParticipantIdentity&{publicKeyPem:string};targets:readonly CompositeEgressTarget[];assertCurrent():void;certificateAuthority?:RequestOptions['ca']}){
 const {root,egressId,generation,assertCurrent,certificateAuthority}=input,targets=structuredClone(input.targets),participant=input.participant;
 const verifier=createCompositeParticipantVerifier({authorityId:participant.authorityId,authorityGeneration:participant.authorityGeneration,instanceIncarnation:participant.instanceIncarnation,keyId:participant.keyId,publicKey:createPublicKey(participant.publicKeyPem)});
 const journal=createCompositeEgressJournal({root,egressId,generation}),pending=new Set<Promise<unknown>>(),controllers=new Set<AbortController>();let closed=false,unresolved=false,closing:Promise<void>|undefined;
 function current(){if(closed)throw Error('composite_egress_closed');assertCurrent();}
 function target(a:CompositeEgressAttempt){const t=targets.find(t=>t.destination===a.destination&&t.model===a.model&&t.protocol===a.protocol);if(!t)throw Error('composite_egress_target_not_configured');return t;}
 async function dispatch(attemptId:string,body:string){current();if(controllers.size>=4)throw Error('composite_egress_capacity');const record=journal.query(attemptId);if(!record||record.state!=='PREPARED')throw Error('composite_egress_not_prepared');const configured=target(record);
  if(typeof body!=='string'||Buffer.byteLength(body)>16*1024**2||createHash('sha256').update(body).digest('hex')!==record.bodySha256)throw Error('composite_egress_body');
  const abort=new AbortController();controllers.add(abort);let drain:Promise<void>|undefined;
  journal.commitDispatch(attemptId);
  try{const fetch=createSingleRequestHttpsFetch({destination:record.destination,expectedBody:body,timeoutMs:120000,maxResponseBytes:16*1024**2,signal:abort.signal,certificateAuthority,trackPhysicalDrain:p=>{drain=p;}});const response=await fetch(record.destination,{method:'POST',headers:configured.headers,body,signal:abort.signal});const result={status:response.status,body:await response.text()};await drain;journal.settle(attemptId,'SUCCEEDED');return result;}
  catch(error){try{if(!drain)throw Error('composite_egress_drain_unconfirmed');await drain;journal.settle(attemptId,'FAILED_AFTER_DISPATCH');}catch{unresolved=true;try{journal.settle(attemptId,'UNKNOWN');}catch{/* Preserve the original durable dispatch. */}}throw error;}
  finally{controllers.delete(abort);}
 }
 return Object.freeze({prepare(attempt:CompositeEgressAttempt,receiptBytes:Buffer){current();target(attempt);const receipt=verifier.verify(receiptBytes,{egressId,egressGeneration:generation,attemptId:attempt.attemptId,invocationId:attempt.invocationId,bodySha256:attempt.bodySha256,destination:attempt.destination,model:attempt.model,protocol:attempt.protocol}),facts=readCompositeParticipantReceipt(verifier,receipt);
  if(attempt.participants.length!==1||attempt.participants[0].authorityId!==facts.authorityId||attempt.participants[0].leaseId!==facts.leaseId||attempt.participants[0].evidenceSha256!==facts.evidenceSha256)throw Error('composite_egress_participant');const r=journal.prepare(attempt);if(r.state==='PREPARING')journal.markPrepared(attempt.attemptId);return journal.query(attempt.attemptId);},
  dispatch(attemptId:string,body:string){const task=dispatch(attemptId,body);pending.add(task);void task.finally(()=>pending.delete(task)).catch(()=>{});return task;},
  query(attemptId:string){current();return journal.query(attemptId);},
  cancel(attemptId:string){current();journal.abortBeforeDispatch(attemptId);return journal.query(attemptId);},
  close(){if(!closing){closed=true;for(const c of controllers)c.abort();closing=Promise.resolve().then(async()=>{await Promise.allSettled([...pending]);if(unresolved)throw Error('composite_egress_shutdown_unresolved');journal.close();});}return closing;}
 });
}
