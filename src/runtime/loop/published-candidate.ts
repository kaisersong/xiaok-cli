import {createHash} from 'node:crypto';
import {readInstalledCurrentOwner} from '../verification/installed-owner-state.js';
import {createInstalledLoopApplicationClient} from '../verification/installed-loop-application.js';
import {createInstalledCompletionPublisher} from '../verification/installed-completion-publication.js';
import {parseLoopApplicationBinding,type LoopApplicationBinding} from '../verification/loop-application-binding.js';
import {parseActiveBusinessApplicationBinding,type ActiveLoopApplicationBinding} from '../verification/business-application-binding.js';
import {loopHostSubjectOwner} from '../verification/loop-host-subject.js';
import {assertLoopApplicationArtifacts} from '../verification/loop-application-artifacts.js';
import {canonicalVerificationJson as json} from '../verification/protocol.js';
import type {VerificationOwner} from '../verification/proof-authority.js';

const negativeReads=new WeakSet<Error>();
function notCurrent(message:string):Error{const error=Error(message);negativeReads.add(error);return error;}
/** Only negatives issued by this fixed reader, never an arbitrary dependency message. */
export function isLoopPublicationNotCurrent(error:unknown):error is Error{return error instanceof Error&&negativeReads.has(error);}

export interface CurrentLoopPublishedCandidate {
 readonly binding:Readonly<LoopApplicationBinding>;
 readonly application:Readonly<ActiveLoopApplicationBinding>;
 readonly owner:Readonly<VerificationOwner>;
 readonly businessRevision:number;
 readonly operationId:string;
 readonly fullTupleHash:string;
 readonly payloadHash:string;
 /** Each read returns an independent copy of the verified historical bytes. */
 readonly bytes:Buffer;
}

/** Fixed installed read only. The returned data is neither a completion write
 * grant nor a continuously current snapshot. Consumers must not cache it as
 * authority, and a Run observation never substitutes for its required stages. */
export async function readCurrentLoopPublishedCandidate(raw:Readonly<LoopApplicationBinding>,signal?:AbortSignal):Promise<Readonly<CurrentLoopPublishedCandidate>> {
 const binding=parseLoopApplicationBinding(raw),requested=loopHostSubjectOwner(binding.subject);
 const deadline=new AbortController(),active=signal?AbortSignal.any([signal,deadline.signal]):deadline.signal;
 const timer=setTimeout(()=>deadline.abort(Error('loop_publication_read_timeout')),10000);
 let application:ReturnType<typeof createInstalledLoopApplicationClient>|undefined;
 let publisher:ReturnType<typeof createInstalledCompletionPublisher>|undefined;
 // Cancellation fences the result but never releases the enclosing host's
 // lifetime before an already-started transport settles. Cooperative transports
 // receive the deadline signal; an uncooperative one must keep shutdown draining.
 async function wait<T>(read:()=>Promise<T>):Promise<T>{
  active.throwIfAborted();
  try{const value=await read();active.throwIfAborted();return value;}
  catch(error){active.throwIfAborted();throw error;}
 }

 try {
  active.throwIfAborted();const route=readInstalledCurrentOwner(requested);
  if(route.kind!=='migrated'&&route.kind!=='protected-unregistered')throw notCurrent('loop_publication_owner_unavailable');
  const routeKey=json(route),owner=Object.freeze({...route.owner});
  function current(){active.throwIfAborted();if(json(readInstalledCurrentOwner(requested))!==routeKey)throw notCurrent('loop_publication_owner_changed');}
  application=createInstalledLoopApplicationClient(binding,'scheduler');
  const before=await wait(()=>application!.inspect(active));current();
  if(before.state!=='active'||before.pendingTransitionId!==null||before.pendingTarget!==null)throw notCurrent('loop_publication_application_pending');
  const originalApplication=parseActiveBusinessApplicationBinding(before.current);
  if(originalApplication.binding.kind!=='loop'||json(originalApplication.binding)!==json(binding))throw notCurrent('loop_publication_application_changed');
  publisher=createInstalledCompletionPublisher(requested,'scheduler');
  const currentPayload=await wait(()=>publisher!.readCurrentPayload(active));current();const observed=currentPayload.observation,publication=observed.publication;
  if(json(observed.owner)!==json(owner)||observed.currentVerification!=='valid'||publication.status!=='committed'||!publication.current)throw notCurrent('loop_publication_not_current');
  const payload=currentPayload.payload;if(!payload)throw Error('loop_publication_payload');
  if(json(payload.owner)!==json(owner)||payload.businessRevision!==observed.businessRevision||payload.operationId!==publication.operationId
   ||payload.fullTupleHash!==publication.fullTupleHash||!Buffer.isBuffer(payload.bytes)||payload.bytes.length>32*1024**2
   ||createHash('sha256').update(payload.bytes).digest('hex')!==payload.payloadHash)throw Error('loop_publication_payload');
  const bytes=Buffer.from(payload.bytes),body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!body||body.version!==1||json(body.owner)!==json(owner)||!Buffer.from(json(body)).equals(bytes)
   ||json(parseActiveBusinessApplicationBinding(body.application))!==json(originalApplication))throw Error('loop_publication_payload_application');
  assertLoopApplicationArtifacts(owner,binding,owner,body.evaluations);
  const afterApplication=await wait(()=>application!.inspect(active));current();
  if(json(afterApplication)!==json(before))throw notCurrent('loop_publication_application_changed');
  const afterPublication=await wait(()=>publisher!.observe(active));current();
  if(json(afterPublication)!==json(observed))throw notCurrent('loop_publication_changed');
  return Object.freeze({binding,application:originalApplication as Readonly<ActiveLoopApplicationBinding>,owner,
   businessRevision:payload.businessRevision,operationId:payload.operationId,fullTupleHash:payload.fullTupleHash,payloadHash:payload.payloadHash,
   get bytes(){return Buffer.from(bytes);}});
 }finally{
  clearTimeout(timer);
  try{publisher?.dispose();}finally{application?.dispose();}
 }
}
