import {createHash} from 'node:crypto';
import {isDeepStrictEqual,types} from 'node:util';
import type {KSwarmService} from './kswarm-service.js';
import {MainUserSubmissionOwner,type SubmissionActor,type RoomConversionIdentity} from './main-user-submission.js';
import {readOrdinaryFollowupContext,type OrdinaryFollowupContext} from './ordinary-followup-context-client.js';
import {ROOM_CONVERSION_SOURCE_SNAPSHOT,type RoomConversionSourceSnapshot} from './room-conversion-source-client.js';
import {captureIpcData} from './ipc-data-snapshot.js';
import {ROOM_CONVERSION_CAPTURE_INPUT,ROOM_CONVERSION_CAPTURE_REFERENCE,type RoomConversionCaptureReference,type RoomConversionCaptureOutput,type RoomConversionCaptureInput} from '../shared/room-conversion-input-contract.js';
interface BrokerSourcePort {getRoomConversionSource(roomId:string,messageId:string,signal:AbortSignal,assertNativeCurrent:()=>void):Promise<unknown>}
const reference=(identity:RoomConversionIdentity):RoomConversionCaptureReference=>ROOM_CONVERSION_CAPTURE_REFERENCE.parse({captureId:identity.captureId,canonicalMessageId:identity.canonicalMessageId,
 canonicalUserTaskId:identity.canonicalUserTaskId,projectId:identity.projectId,roomId:identity.roomId,roomMessageId:identity.roomMessageId});
/** Main's sole original-input source composition. Broker reads attest the
 * historical read point, not remote current state or any future B/model grant. */
export function createMainRoomConversionCaptureOwner(options:{submissions:MainUserSubmissionOwner;scope:{profileId:string;workspaceId:string};gateway:Pick<KSwarmService,'request'|'getDesktopMutationToken'>}){
 const {submissions,gateway}=options,scope=Object.freeze({...options.scope}),lifecycle=new AbortController();let sealed=false;
 let readSource:BrokerSourcePort['getRoomConversionSource']|undefined,realmId:string|undefined;
 const inflight=new Map<string,Promise<RoomConversionCaptureOutput>>();
 const proofs=new WeakMap<object,{owner:MainUserSubmissionOwner;fact:unknown;assertCurrent:()=>void}>();
 const assertActor=(actor:SubmissionActor|undefined,recheck:()=>void)=>{
  if(actor?.requestSource!=='user'||actor.actorId!==`desktop-user:${scope.profileId}`)throw Error('user_submission_actor_forbidden');
  if(types.isAsyncFunction(recheck))throw Error('user_submission_actor_forbidden');
  const result=recheck();if(result!==undefined){if(types.isPromise(result))Reflect.apply(Promise.prototype.then,result,[()=>undefined,()=>undefined]);throw Error('user_submission_actor_forbidden');}
 };
 const assertProject=(project:OrdinaryFollowupContext,roomId:string)=>{
  if(project.primaryRoomId!==roomId)throw Error('room_conversion_room_scope_mismatch');
  if(project.projectStatus==='closed'||project.projectStatus==='delivered')throw Error('PROJECT_TERMINAL_REQUIRES_REOPEN');
 };
 const assertSource=(value:unknown,roomId:string,messageId:string,projectId:string):RoomConversionSourceSnapshot=>{
  const parsed=ROOM_CONVERSION_SOURCE_SNAPSHOT.safeParse(captureIpcData(value,'room_conversion_source_unavailable'));
  if(!parsed.success)throw Error('room_conversion_source_unavailable');const source=parsed.data;
  // The dedicated Desktop transport is mapped to this principal by Broker's
  // actual token-authenticated HTTP handler, never by message author/body.
  if(source.actorUserId!=='user.local'||source.roomId!==roomId||source.messageId!==messageId
    ||source.contextScope.kind==='project'&&source.contextScope.projectId!==projectId)throw Error('room_conversion_room_scope_mismatch');
  if(realmId!==undefined&&source.realmId!==realmId)throw Error('room_conversion_broker_identity_changed');return source;
 };
 const captureOriginal=async(input:RoomConversionCaptureInput,actor:SubmissionActor|undefined,current:()=>void):Promise<RoomConversionCaptureOutput>=>{
   const signal=AbortSignal.any([lifecycle.signal,AbortSignal.timeout(15_000)]);
   const historical=await submissions.observeRoomConversionIntent(input,actor,signal,current);current();
   if(historical)return {capture:reference(historical),execution:{state:'blocked',reasonCode:input.action==='add_task'?'CANDIDATE_WORKSPACE_UNAVAILABLE':'REVISION_BASE_NOT_READY'}};
   const reader=readSource;if(!reader)throw Error('room_conversion_unavailable');
   const before=await readOrdinaryFollowupContext(gateway,input.projectId,scope,signal,current);current();assertProject(before,input.roomId);
   const rawFirst=await reader(input.roomId,input.messageId,signal,current);current();const first=assertSource(rawFirst,input.roomId,input.messageId,input.projectId);
   const after=await readOrdinaryFollowupContext(gateway,input.projectId,scope,signal,current);current();assertProject(after,input.roomId);
   if(!isDeepStrictEqual(before,after))throw Error('room_conversion_project_revision_conflict');
   const rawSource=await reader(input.roomId,input.messageId,signal,current);current();const source=assertSource(rawSource,input.roomId,input.messageId,input.projectId);
   if(!isDeepStrictEqual(first,source))throw Error('room_conversion_source_changed');
   // Synchronous first binding is the sole initialization critical section;
   // concurrent reads cannot enter a second bind or replace this original owner.
   const brokerOriginDigest=createHash('sha256').update(JSON.stringify(['broker-room-realm-v1',source.realmId])).digest('hex');
   if(realmId===undefined){submissions.bindRoomConversionSources({brokerOriginDigest,verify(proof,expectedOwner){const entry=proofs.get(proof);if(!entry||entry.owner!==expectedOwner)throw Error('room_conversion_source_unverified');entry.assertCurrent();return entry;}});realmId=source.realmId;}
   const proof=Object.freeze(Object.create(null));let active=true;
   proofs.set(proof,{owner:submissions,assertCurrent(){current();if(!active)throw Error('room_conversion_source_unverified');},fact:{...scope,actorId:actor!.actorId,brokerUserId:source.actorUserId,brokerOriginDigest,intent:input,
    source:{roomId:source.roomId,messageId:source.messageId,messageSequence:source.messageSequence,text:source.text,roomRevision:source.roomRevision,membershipRevision:source.membershipRevision},
    project:{projectId:after.projectId,primaryRoomId:after.primaryRoomId,bindingDigest:after.bindingDigest,classification:after.classification,projectRevision:after.projectRevision}}});
   try{const captured=submissions.captureRoomConversion(input,actor,proof);current();return {capture:reference(captured.identity),execution:{state:'blocked',reasonCode:input.action==='add_task'?'CANDIDATE_WORKSPACE_UNAVAILABLE':'REVISION_BASE_NOT_READY'}};}
   finally{active=false;proofs.delete(proof);}
 };
 return Object.freeze({
  bindBroker(client:BrokerSourcePort){
   if(sealed)throw Error('room_conversion_closed');if(readSource)throw Error('room_conversion_source_owner_conflict');
   if(typeof client?.getRoomConversionSource!=='function')throw Error('room_conversion_source_unavailable');readSource=client.getRoomConversionSource.bind(client);
  },
  seal(){sealed=true;lifecycle.abort(Error('room_conversion_closed'));},
  async drain(){while(inflight.size)await Promise.allSettled([...inflight.values()]);await submissions.drainRoomConversionObservations();},
  observe(captureId:string,actor:SubmissionActor|undefined,recheck:()=>void):RoomConversionCaptureReference{
   assertActor(actor,recheck);return reference(submissions.observeRoomConversion(captureId,actor));
  },
  async capture(raw:unknown,actor:SubmissionActor|undefined,recheck:()=>void):Promise<RoomConversionCaptureOutput>{
   const current=()=>{assertActor(actor,recheck);if(sealed)throw Error('room_conversion_closed');};current();
   const parsed=ROOM_CONVERSION_CAPTURE_INPUT.safeParse(captureIpcData(raw,'room_conversion_input_invalid'));if(!parsed.success)throw Error('room_conversion_input_invalid');const input=parsed.data;
   const key=createHash('sha256').update(JSON.stringify(input)).digest('hex');let pending=inflight.get(key);
   if(!pending){pending=captureOriginal(input,actor,current);inflight.set(key,pending);}
   try{const result=await pending;current();return structuredClone(result);}
   finally{if(inflight.get(key)===pending)inflight.delete(key);}
  },
 });
}
