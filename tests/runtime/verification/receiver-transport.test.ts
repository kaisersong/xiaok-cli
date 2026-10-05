import {createReceiverUploadVerifier} from '../../../src/runtime/verification/receiver-upload-authentication.js';
import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {VerificationReceiverStore} from '../../../src/runtime/verification/receiver-store.js';
import {createReceiverReplyVerifier} from '../../../src/runtime/verification/receiver-authentication.js';
import {parseVerificationTuple,hashVerificationTuple} from '../../../src/runtime/verification/protocol.js';
import {startReceiverService} from '../../../src/runtime/verification/receiver-service.js';
import {readControllerSocketAuditPeer} from '../../../src/runtime/verification/socket-peer.js';
import {createReceiverTransport} from '../../../src/runtime/verification/receiver-transport.js';
function tupleFor(payload:string){const h='a'.repeat(64);return parseVerificationTuple({schemaVersion:1,profileId:'profile',ownerKind:'task',ownerId:'task1',migrationEpoch:1,expectedBusinessRevision:2,obligationSetRevision:3,obligationSetHash:h,obligations:[{obligationId:'check1',predicateId:'original',predicateVersion:'1',definitionHash:h,activeAttemptId:'attempt1',attemptEpoch:1,sourceRunId:'run1',runNonce:'nonce1',subjectId:'subject1',contentRoot:h,coreId:'core1',coreHash:h,coreFinalRevision:1,proofId:'proof1',proofHash:h,proofRevision:1,requiredScopeId:'scope1',scopeRevision:1,invalidationEpoch:1}],operationId:'operation1',immutablePayloadHash:createHash('sha256').update(payload).digest('hex'),receiverId:'receiver1',receiverProtocolVersion:1,receiverInstanceEpoch:1,reservationId:'reservation1',nonce:'nonce2',notBefore:1000,validUntil:2000,clockDomainId:'clock1',clockQualificationEpoch:1});}
it.skipIf(process.platform!=='darwin').each(['commit','cancel','uid','key','payload','revoked','close','upload','large-tuple','large-cancel','unknown','before-send-async','before-send-revoked'] as const)('actual kernel private receiver transport: %s',async mode=>{
 const root=mkdtempSync(join(tmpdir(),'receiver-transport-')),helper=join(root,'peer'),socketPath=join(root,'r.sock'),keys=generateKeyPairSync('ed25519');
 const built=spawnSync('/usr/bin/cc',['-O2','-Wall','-Wextra','-Werror',resolve('src/runtime/verification/native/socket-audit-peer.c'),'-lbsm','-o',helper],{encoding:'utf8'});expect(built.status,built.stderr).toBe(0);
 const identity={receiverId:'receiver1',receiverInstanceEpoch:1,keyId:'key'};let live=true;
 const store=new VerificationReceiverStore({root:join(root,'state'),...identity,clock:()=>({domainId:'clock1',qualificationEpoch:1,lowerBound:1500,upperBound:1500,evidenceHash:'e'.repeat(64)})});
 const service=await startReceiverService({socketPath,controllerServiceUid:process.getuid!(),identity,privateKey:keys.privateKey,store,assertCurrent(){},readPeer:socket=>readControllerSocketAuditPeer(socket,helper)});
 const verifier=createReceiverReplyVerifier({...identity,publicKey:mode==='key'?generateKeyPairSync('ed25519').publicKey:keys.publicKey});
 const transport=createReceiverTransport({socketPath,receiverServiceUid:process.getuid!()+(mode==='uid'?1:0),identity,verifier,uploadVerifier:createReceiverUploadVerifier({...identity,publicKey:keys.publicKey}),assertCurrent(){if(!live)throw Error('revoked');},readPeer:socket=>readControllerSocketAuditPeer(socket,helper)});
 const payload=['upload','large-tuple'].includes(mode)?'x'.repeat(2*1024**2+17):'artifact';
 const tuple={...tupleFor(payload)};
 if(mode==='large-tuple'||mode==='large-cancel'){const original=tuple.obligations[0];tuple.obligations=Array.from({length:256},(_,i)=>({...original,...Object.fromEntries(['obligationId','predicateId','predicateVersion','activeAttemptId','sourceRunId','runNonce','subjectId','coreId','proofId','requiredScopeId'].map(k=>[k,String(i).padStart(3,'0')+'x'.repeat(47)+'\\'.repeat(110)]))}));tuple.profileId='p'.repeat(160);tuple.obligations=tuple.obligations.map(d=>({...d,kind:'inherited' as const,originOwner:{profileId:tuple.profileId,ownerKind:'task' as const,ownerId:'y'.repeat(160)},originalObligationId:d.obligationId}));expect(Buffer.byteLength(JSON.stringify(tuple))).toBeGreaterThan(990000);}
 const fullTupleHash=hashVerificationTuple(tuple),challenge='c'.repeat(64),base={tuple,fullTupleHash,challenge};
 try{
  if(mode==='before-send-async'||mode==='before-send-revoked'){let calls=0;await expect(transport.call('stage',{...base,payload},undefined,()=>{calls++;if(mode==='before-send-revoked')throw Error('operation revoked');return Promise.resolve();})).rejects.toThrow(mode==='before-send-async'?'receiver_transport_before_send_sync':'operation revoked');expect(calls).toBe(1);expect(store.query(tuple,fullTupleHash)).toBeUndefined();return;}
  if(mode==='close'){const closed=transport.close();expect(transport.close()).toBe(closed);await closed;await expect(transport.call('query',base)).rejects.toThrow();return;}
  if(mode==='revoked'){live=false;await expect(transport.call('query',base)).rejects.toThrow();live=true;await expect(transport.call('query',base)).rejects.toThrow();return;}
  if(mode==='uid'||mode==='payload'){await expect(transport.call('stage',{...base,payload:mode==='payload'?'changed':'artifact'})).rejects.toThrow();expect(store.query(tuple,fullTupleHash)).toBeUndefined();return;}
  if(mode==='key'){await expect(transport.call('stage',{...base,payload:'artifact'})).rejects.toThrow();expect(store.query(tuple,fullTupleHash)?.status).toBe('prepared');return;}
  if(mode==='unknown'){const q=await transport.call('query',base);expect(verifier.read(q.authenticated).result.status).toBe('unknown');expect(store.resolveRegisteredTuple(tuple.operationId,fullTupleHash)).toBeUndefined();return;}
  if(mode==='large-cancel'){const q=await transport.call('cancel',base);expect(verifier.read(q.authenticated).result.status).toBe('cancelled');expect(verifier.read((await transport.call('query',base)).authenticated).result.status).toBe('cancelled');return;}
  const stage=['upload','large-tuple'].includes(mode)?await transport.stagePayload(base,Buffer.from(payload)):await transport.call('stage',{...base,payload:'artifact'});expect(verifier.read(stage.authenticated).result.status).toBe('prepared');
  const terminal=await transport.call(mode==='cancel'?'cancel':'commit',{...base,...(mode!=='cancel'?{expectedRevision:1}:{})});expect(verifier.read(terminal.authenticated).result.status).toBe(mode==='cancel'?'cancelled':'committed');
  const query=await transport.call('query',base);expect(query.envelope).toEqual(terminal.envelope);
 }finally{await transport.close();await service.close();store.close();rmSync(root,{recursive:true,force:true});}
});
