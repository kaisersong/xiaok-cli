import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {readControllerSocketAuditPeer} from '../../../src/runtime/verification/socket-peer.js';
import {tmpdir} from 'node:os';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {VerificationReceiverStore} from '../../../src/runtime/verification/receiver-store.js';
import {createReceiverReplyVerifier} from '../../../src/runtime/verification/receiver-authentication.js';
import {parseVerificationTuple,hashVerificationTuple,canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
import {callControllerIpc} from '../../../src/runtime/verification/controller-ipc.js';
import {startReceiverService} from '../../../src/runtime/verification/receiver-service.js';
function fixture(payload: string) {
  const h = 'a'.repeat(64);
  return parseVerificationTuple({ schemaVersion: 1, profileId: 'profile', ownerKind: 'task', ownerId: 'task1', migrationEpoch: 1,
    expectedBusinessRevision: 2, obligationSetRevision: 3, obligationSetHash: h,
    obligations: [{ obligationId: 'check1', predicateId: 'original', predicateVersion: '1', definitionHash: h,
      activeAttemptId: 'attempt1', attemptEpoch: 1, sourceRunId: 'run1', runNonce: 'nonce1', subjectId: 'subject1',
      contentRoot: h, coreId: 'core1', coreHash: h, coreFinalRevision: 1, proofId: 'proof1', proofHash: h,
      proofRevision: 1, requiredScopeId: 'scope1', scopeRevision: 1, invalidationEpoch: 1 }],
    operationId: 'operation1', immutablePayloadHash: createHash('sha256').update(payload).digest('hex'),
    receiverId: 'receiver1', receiverProtocolVersion: 1, receiverInstanceEpoch: 1,
    reservationId: 'reservation1', nonce: 'nonce2', notBefore: 1000, validUntil: 2000, clockDomainId: 'clock1', clockQualificationEpoch: 1 });
}

// Real IPC/store/signatures; injected peer and clock are not installed OS qualification.
it.each(['commit','cancel','unknown','uid','extra','hash','payload','epoch','expired','closed','peer-pid','peer-asid','peer-extra'] as const)('actual receiver service boundary: %s',async mode=>{
 const root=mkdtempSync(join(tmpdir(),'receiver-service-')),socketPath=join(root,'r.sock'),keys=generateKeyPairSync('ed25519');let uid=700,live=true,now=1500;
 const identity={receiverId:'receiver1',receiverInstanceEpoch:1,keyId:'key'},store=new VerificationReceiverStore({root:join(root,'state'),...identity,clock:()=>({domainId:'clock1',qualificationEpoch:1,lowerBound:now,upperBound:now,evidenceHash:'e'.repeat(64)})}),verifier=createReceiverReplyVerifier({...identity,publicKey:keys.publicKey});
 const service=await startReceiverService({socketPath,controllerServiceUid:700,identity,privateKey:keys.privateKey,store,assertCurrent(){if(!live)throw Error('revoked');},readPeer(){return {uid,gid:700,auditSessionId:mode==='peer-asid'?0:1,pid:mode==='peer-pid'?0:123,...(mode==='peer-extra'?{untrusted:true}:{})};}});
 const tuple=fixture('artifact'),fullTupleHash=hashVerificationTuple(tuple),challenge='c'.repeat(64),base={version:1,domain:'xiaok.receiver.request.v1',fullTupleHash,challenge};
 const call=async(method:string,extra:object={})=>{const reply=JSON.parse((await callControllerIpc(socketPath,Buffer.from(json({...base,...(method==='stage'?{tuple}:{operationId:tuple.operationId}),method,...extra})))).toString());return verifier.read(verifier.verify(reply,{fullTupleHash,challenge})).result;};
 try{
  if(mode.startsWith('peer-')){await expect(call('query')).rejects.toThrow();return;}
  if(mode==='uid'){uid=501;await expect(call('stage',{payload:'artifact',uid:700})).rejects.toThrow();expect(store.query(tuple,fullTupleHash)).toBeUndefined();return;}
  if(mode==='extra'){await expect(call('stage',{payload:'artifact',requestSource:'user'})).rejects.toThrow();return;}
  if(mode==='hash'){await expect(call('stage',{payload:'artifact',fullTupleHash:'f'.repeat(64)})).rejects.toThrow();return;}
  if(mode==='payload'){await expect(call('stage',{payload:'different'})).rejects.toThrow();return;}
  if(mode==='epoch'){await expect(call('query',{tuple:{...tuple,receiverInstanceEpoch:2}})).rejects.toThrow();return;}
  if(mode==='closed'){live=false;await expect(call('query')).rejects.toThrow();live=true;await expect(call('query')).rejects.toThrow();return;}
  if(mode==='unknown'){expect(await call('query')).toMatchObject({status:'unknown',fullTupleHash});return;}
  if(mode==='cancel'){await callControllerIpc(socketPath,Buffer.from(json(tuple)));expect(await call('cancel')).toHaveProperty('status','cancelled');expect(await call('stage',{payload:'artifact'})).toHaveProperty('status','cancelled');expect(store.readVisible(tuple.operationId)).toBeUndefined();return;}
  expect(await call('stage',{payload:'artifact'})).toHaveProperty('status','prepared');
  if(mode==='expired')now=2000;
  const result=await call('commit',{expectedRevision:1});expect(result.status).toBe(mode==='expired'?'cancelled':'committed');expect(await call('query')).toEqual(result);expect(await call('commit',{expectedRevision:1})).toEqual(result);
  expect(store.readBusinessCompletion({profileId:tuple.profileId,ownerKind:tuple.ownerKind,ownerId:tuple.ownerId},tuple.operationId,fullTupleHash)?.payload).toBe(mode==='expired'?undefined:'artifact');
 }finally{await service.close();store.close();rmSync(root,{recursive:true,force:true});}
});

// Uses the production native reader, service, IPC, store and reply verifier together.
// Same local UID is a transport contract check, not independent installed accounts.
it.skipIf(process.platform!=='darwin')('accepts the actual kernel audit peer through the receiver service',async()=>{
 const root=mkdtempSync(join(tmpdir(),'receiver-kernel-')),helper=join(root,'peer'),socketPath=join(root,'r.sock'),keys=generateKeyPairSync('ed25519');
 const built=spawnSync('/usr/bin/cc',['-O2','-Wall','-Wextra','-Werror',resolve('src/runtime/verification/native/socket-audit-peer.c'),'-lbsm','-o',helper],{encoding:'utf8'});expect(built.status,built.stderr).toBe(0);
 const identity={receiverId:'receiver1',receiverInstanceEpoch:1,keyId:'key'},store=new VerificationReceiverStore({root:join(root,'state'),...identity,clock:()=>({domainId:'clock1',qualificationEpoch:1,lowerBound:1500,upperBound:1500,evidenceHash:'e'.repeat(64)})});
 const verifier=createReceiverReplyVerifier({...identity,publicKey:keys.publicKey});let peer:ReturnType<typeof readControllerSocketAuditPeer>|undefined;
 const service=await startReceiverService({socketPath,controllerServiceUid:process.getuid!(),identity,privateKey:keys.privateKey,store,assertCurrent(){},readPeer(socket){peer=readControllerSocketAuditPeer(socket,helper);return peer;}});
 const tuple=fixture('artifact'),fullTupleHash=hashVerificationTuple(tuple),challenge='c'.repeat(64),base={version:1,domain:'xiaok.receiver.request.v1',fullTupleHash,challenge};
 try{
  for(const [method,extra,status] of [['stage',{payload:'artifact'},'prepared'],['commit',{expectedRevision:1},'committed'],['query',{},'committed']] as const){
   const reply=JSON.parse((await callControllerIpc(socketPath,Buffer.from(json({...base,...(method==='stage'?{tuple}:{operationId:tuple.operationId}),method,...extra})))).toString());
   expect(verifier.read(verifier.verify(reply,{fullTupleHash,challenge})).result.status).toBe(status);
  }
  expect(peer).toMatchObject({uid:process.getuid!(),gid:process.getgid!(),pid:process.pid});expect(peer!.auditSessionId).toBeGreaterThan(0);
  expect(store.readBusinessCompletion({profileId:tuple.profileId,ownerKind:tuple.ownerKind,ownerId:tuple.ownerId},tuple.operationId,fullTupleHash)?.payload).toBe('artifact');
 }finally{await service.close();store.close();rmSync(root,{recursive:true,force:true});}
});
