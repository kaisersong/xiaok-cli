import {createHash,type KeyObject} from 'node:crypto';
import {createReceiverUploadSigner} from './receiver-upload-authentication.js';
import type {Socket} from 'node:net';
import type {readControllerSocketAuditPeer} from './socket-peer.js';
import {startControllerIpc} from './controller-ipc.js';
import {canonicalVerificationJson as json,parseVerificationTuple,hashVerificationTuple} from './protocol.js';
import {createReceiverReplySigner,type Identity} from './receiver-authentication.js';
import type {VerificationReceiverStore} from './receiver-store.js';
/** Private service boundary. Only the installed entry supplies protected identity,
 * actual kernel peer reader and store clock; injection does not qualify an OS. */
export async function startReceiverService(input:{socketPath:string;controllerServiceUid:number;identity:Identity;privateKey:KeyObject;store:VerificationReceiverStore;assertCurrent():void;readPeer(socket:Socket):ReturnType<typeof readControllerSocketAuditPeer>}){
 const {socketPath,controllerServiceUid,store}=input,assertCurrent=input.assertCurrent.bind(input),readPeer=input.readPeer.bind(input);
 if(!Number.isSafeInteger(controllerServiceUid)||controllerServiceUid<1)throw Error('receiver_service_controller_uid');
 const signer=createReceiverReplySigner({...input.identity,privateKey:input.privateKey}),uploadSigner=createReceiverUploadSigner({...input.identity,privateKey:input.privateKey});let closed=false,closing:Promise<void>|undefined;
 function current(){if(closed)throw Error('receiver_service_closed');try{const value:unknown=assertCurrent();if(value!==undefined){void Promise.resolve(value).catch(()=>{});throw Error('receiver_service_current_sync');}}catch(error){closed=true;throw error;}}
 current();
 const server=await startControllerIpc({socketPath,publicPeerAuthenticated:true,
  acceptPeer(socket){current();const peer=readPeer(socket);if(peer&&typeof (peer as unknown as {then?:unknown}).then==='function'){void Promise.resolve(peer).catch(()=>{});throw Error('receiver_service_peer');}if(!peer||Object.keys(peer).sort().join(',')!=='auditSessionId,gid,pid,uid'||peer.uid!==controllerServiceUid||!Number.isSafeInteger(peer.gid)||peer.gid<0||!Number.isSafeInteger(peer.auditSessionId)||peer.auditSessionId<1||!Number.isSafeInteger(peer.pid)||peer.pid<1)throw Error('receiver_service_peer');current();return Object.freeze({...peer});},
  async dispatch(bytes,signal,peer){
   current();signal.throwIfAborted();if((peer as {uid:number})?.uid!==controllerServiceUid)throw Error('receiver_service_peer');
   const request=JSON.parse(bytes.toString('utf8'));
   if(request?.schemaVersion===1){
    if(!Buffer.from(json(request)).equals(bytes))throw Error('receiver_service_canonical');
    const tuple=parseVerificationTuple(request),hash=hashVerificationTuple(tuple),progress=store.registerUpload(tuple);
    current();signal.throwIfAborted();return Buffer.from(json(uploadSigner.sign({requestHash:hash,challenge:createHash('sha256').update('upload-register:'+hash).digest('hex')},progress)));
   }
   if(!request||typeof request!=='object'||Array.isArray(request)||!Buffer.from(json(request)).equals(bytes)||request.version!==1||request.domain!=='xiaok.receiver.request.v1'||!['stage','commit','cancel','query','upload-chunk','upload-finish'].includes(request.method)||typeof request.challenge!=='string'||!/^[a-f0-9]{64}$/.test(request.challenge))throw Error('receiver_service_request');
   const fields=['version','domain','method',...(request.method==='stage'?['tuple']:['operationId']),'fullTupleHash','challenge',...(request.method==='stage'?['payload']:request.method==='commit'?['expectedRevision']:request.method==='upload-chunk'?['totalBytes','offset','chunkHash','bytesBase64']:[])];
   if(Object.keys(request).sort().join(',')!==fields.sort().join(','))throw Error('receiver_service_fields');
   const tuple=request.method==='stage'?parseVerificationTuple(request.tuple):store.resolveRegisteredTuple(request.operationId,request.fullTupleHash);if(tuple&&hashVerificationTuple(tuple)!==request.fullTupleHash)throw Error('receiver_service_tuple_hash');if(!tuple&&request.method!=='query')throw Error('receiver_service_unregistered');
   if(request.method==='commit'&&(!Number.isSafeInteger(request.expectedRevision)||request.expectedRevision<1))throw Error('receiver_service_revision');
   current();signal.throwIfAborted();
   if(request.method==='upload-chunk'){
    if(typeof request.bytesBase64!=='string'||request.bytesBase64.length>4*Math.ceil(256*1024/3)||Buffer.from(request.bytesBase64,'base64').toString('base64')!==request.bytesBase64)throw Error('receiver_upload_base64');
    const progress=store.uploadChunk({tuple:tuple!,fullTupleHash:request.fullTupleHash,totalBytes:request.totalBytes,offset:request.offset,chunkHash:request.chunkHash,bytes:Buffer.from(request.bytesBase64,'base64')});
    current();signal.throwIfAborted();const signed=uploadSigner.sign({requestHash:createHash('sha256').update(bytes).digest('hex'),challenge:request.challenge},progress);current();return Buffer.from(json(signed));
   }
   const result=request.method==='upload-finish'?store.finishUpload(tuple!,request.fullTupleHash):request.method==='stage'?store.stage(tuple,request.payload):request.method==='commit'?store.commit(tuple!,request.fullTupleHash,request.expectedRevision):request.method==='cancel'?store.cancel(tuple!,request.fullTupleHash):(tuple?store.query(tuple,request.fullTupleHash):undefined)??{status:'unknown' as const,fullTupleHash:request.fullTupleHash};
   // Revocation after a commit suppresses disclosure, never invents rollback.
   current();signal.throwIfAborted();const reply=signer.sign({fullTupleHash:request.fullTupleHash,challenge:request.challenge},result);current();return Buffer.from(json(reply));
  },
 });
 return Object.freeze({close(){if(!closing){closed=true;closing=Promise.resolve().then(()=>server.close());}return closing;}});
}
