import {createHash,randomBytes} from 'node:crypto';
import type {createReceiverUploadVerifier,SignedUploadReply} from './receiver-upload-authentication.js';
import type {Socket} from 'node:net';
import {callControllerIpc} from './controller-ipc.js';
import {canonicalVerificationJson as json,parseVerificationTuple,hashVerificationTuple,type VerificationTuple,VERIFICATION_BUDGET} from './protocol.js';
import type {Identity,SignedReceiverReply,createReceiverReplyVerifier} from './receiver-authentication.js';
import type {readControllerSocketAuditPeer} from './socket-peer.js';
type Method='stage'|'commit'|'cancel'|'query'|'upload-finish';
type Request={tuple:VerificationTuple;fullTupleHash:string;challenge:string;payload?:string;expectedRevision?:number};
/** Private protocol assembly. Ports in tests do not establish installed authority.
 * Unknown transport outcomes never trigger replay, cancellation or completion. */
export function createReceiverTransport(input:{socketPath:string;receiverServiceUid:number;identity:Identity;verifier:Pick<ReturnType<typeof createReceiverReplyVerifier>,'verify'|'read'>;uploadVerifier:ReturnType<typeof createReceiverUploadVerifier>;assertCurrent():void;readPeer(socket:Socket):ReturnType<typeof readControllerSocketAuditPeer>}){
 const socketPath=input.socketPath,uid=input.receiverServiceUid,identity=JSON.parse(json(input.identity)) as Identity;
 const assertCurrent=input.assertCurrent.bind(input),readPeer=input.readPeer.bind(input),verify=input.verifier.verify.bind(input.verifier),read=input.verifier.read.bind(input.verifier),verifyUpload=input.uploadVerifier.verify.bind(input.uploadVerifier);
 if(!Number.isSafeInteger(uid)||uid<1)throw Error('receiver_transport_uid');
 const lifetime=new AbortController(),pending=new Set<Promise<unknown>>();let closed=false,closing:Promise<void>|undefined;
 function current(){if(closed)throw Error('receiver_transport_closed');try{const result:unknown=assertCurrent();if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error('receiver_transport_current_sync');}}catch(error){closed=true;lifetime.abort();throw error;}}
 current();
 async function exchange(bytes:Buffer,signal:AbortSignal,beforeSend?:()=>void){return callControllerIpc(socketPath,bytes,{signal,verifyServerPeer(socket){
   current();const peer=readPeer(socket);
   if(!peer||Object.keys(peer).sort().join(',')!=='auditSessionId,gid,pid,uid'||peer.uid!==uid||!Number.isSafeInteger(peer.gid)||peer.gid<0||!Number.isSafeInteger(peer.auditSessionId)||peer.auditSessionId<1||!Number.isSafeInteger(peer.pid)||peer.pid<1)throw Error('receiver_transport_peer');
   current();if(beforeSend){const result:unknown=beforeSend();if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error('receiver_transport_before_send_sync');}}
 }});}
 async function register(tuple:VerificationTuple,signal:AbortSignal,beforeSend?:()=>void){
  const fullTupleHash=hashVerificationTuple(tuple),response=await exchange(Buffer.from(json(tuple)),signal,beforeSend);current();signal.throwIfAborted();
  const envelope=JSON.parse(response.toString('utf8')) as SignedUploadReply;if(!Buffer.from(json(envelope)).equals(response))throw Error('receiver_transport_canonical');
  const progress=verifyUpload(envelope,{requestHash:fullTupleHash,challenge:createHash('sha256').update('upload-register:'+fullTupleHash).digest('hex')});
  if(progress.fullTupleHash!==fullTupleHash)throw Error('receiver_transport_upload_binding');return progress;
 }
 async function call(method:Method,raw:Request,signal?:AbortSignal,beforeSend?:()=>void){
  current();if(beforeSend!==undefined&&typeof beforeSend!=='function')throw Error('receiver_transport_before_send');const p=JSON.parse(json(raw));
  if(!['stage','commit','cancel','query','upload-finish'].includes(method)||!p||Object.keys(p).sort().join(',')!==['tuple','fullTupleHash','challenge',...(method==='stage'?['payload']:method==='commit'?['expectedRevision']:[])].sort().join(','))throw Error('receiver_transport_request');
  const tuple=parseVerificationTuple(p.tuple);
  if(hashVerificationTuple(tuple)!==p.fullTupleHash||typeof p.challenge!=='string'||!/^[a-f0-9]{64}$/.test(p.challenge)||tuple.receiverId!==identity.receiverId||tuple.receiverInstanceEpoch!==identity.receiverInstanceEpoch)throw Error('receiver_transport_binding');
  if(method==='stage'&&(typeof p.payload!=='string'||createHash('sha256').update(p.payload).digest('hex')!==tuple.immutablePayloadHash))throw Error('receiver_transport_payload');
  if(method==='commit'&&(!Number.isSafeInteger(p.expectedRevision)||p.expectedRevision<1))throw Error('receiver_transport_revision');
  const combined=AbortSignal.any([lifetime.signal,...(signal?[signal]:[])]);combined.throwIfAborted();
  if(method==='cancel')await register(tuple,combined,beforeSend);
  const {tuple:ignored,...reference}=p;
  const bytes=await exchange(Buffer.from(json({version:1,domain:'xiaok.receiver.request.v1',method,...reference,...(method==='stage'?{tuple}:{operationId:tuple.operationId})})),combined,beforeSend);
  current();combined.throwIfAborted();const envelope=JSON.parse(bytes.toString('utf8')) as SignedReceiverReply;
  if(!Buffer.from(json(envelope)).equals(bytes))throw Error('receiver_transport_canonical');
  const authenticated=verify(envelope,{fullTupleHash:p.fullTupleHash,challenge:p.challenge});read(authenticated);current();combined.throwIfAborted();
  return Object.freeze({envelope,authenticated});
 }
 async function stagePayload(raw:Pick<Request,'tuple'|'fullTupleHash'|'challenge'>,original:Buffer,signal?:AbortSignal,beforeSend?:()=>void){
  current();if(beforeSend!==undefined&&typeof beforeSend!=='function')throw Error('receiver_transport_before_send');if(!Buffer.isBuffer(original)||original.length<1||original.length>VERIFICATION_BUDGET.outboxPayloadBytes)throw Error('receiver_transport_payload');
  const base=JSON.parse(json(raw)),tuple=parseVerificationTuple(base.tuple),body=Buffer.from(original);
  if(Object.keys(base).sort().join(',')!=='challenge,fullTupleHash,tuple'||hashVerificationTuple(tuple)!==base.fullTupleHash||typeof base.challenge!=='string'||!/^[a-f0-9]{64}$/.test(base.challenge)||tuple.receiverId!==identity.receiverId||tuple.receiverInstanceEpoch!==identity.receiverInstanceEpoch||createHash('sha256').update(body).digest('hex')!==tuple.immutablePayloadHash||!Buffer.from(body.toString('utf8')).equals(body))throw Error('receiver_transport_binding');
  const combined=AbortSignal.any([lifetime.signal,...(signal?[signal]:[])]);
  const registration=await register(tuple,combined,beforeSend);
  if(registration.totalBytes!==0&&registration.totalBytes!==body.length)throw Error('receiver_transport_upload_binding');
  for(let offset=registration.receivedBytes;offset<body.length;offset+=256*1024){
   current();combined.throwIfAborted();const chunk=body.subarray(offset,Math.min(offset+256*1024,body.length)),challenge=randomBytes(32).toString('hex');
   const bytes=Buffer.from(json({version:1,domain:'xiaok.receiver.request.v1',method:'upload-chunk',operationId:tuple.operationId,fullTupleHash:base.fullTupleHash,challenge,totalBytes:body.length,offset,chunkHash:createHash('sha256').update(chunk).digest('hex'),bytesBase64:chunk.toString('base64')}));
   const response=await exchange(bytes,combined,beforeSend);current();combined.throwIfAborted();const envelope=JSON.parse(response.toString('utf8')) as SignedUploadReply;
   if(!Buffer.from(json(envelope)).equals(response))throw Error('receiver_transport_canonical');
   const progress=verifyUpload(envelope,{requestHash:createHash('sha256').update(bytes).digest('hex'),challenge});
   if(progress.fullTupleHash!==base.fullTupleHash||progress.totalBytes!==body.length||progress.receivedBytes<offset+chunk.length)throw Error('receiver_transport_upload_binding');current();
  }
  return call('upload-finish',base,combined,beforeSend);
 }
 function tracked<T>(work:Promise<T>){pending.add(work);void work.then(()=>pending.delete(work),()=>pending.delete(work));return work;}
 return Object.freeze({call(method:Method,payload:Request,signal?:AbortSignal,beforeSend?:()=>void){return tracked(call(method,payload,signal,beforeSend));},stagePayload(base:Pick<Request,'tuple'|'fullTupleHash'|'challenge'>,bytes:Buffer,signal?:AbortSignal,beforeSend?:()=>void){return tracked(stagePayload(base,bytes,signal,beforeSend));},close(){if(!closing){closing=Promise.resolve().then(async()=>{await Promise.allSettled([...pending]);});closed=true;lifetime.abort();}return closing;}});
}
