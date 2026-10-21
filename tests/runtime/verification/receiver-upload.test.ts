import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {VerificationReceiverStore} from '../../../src/runtime/verification/receiver-store.js';
import {parseVerificationTuple,hashVerificationTuple} from '../../../src/runtime/verification/protocol.js';
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

it.each(['complete','reopen','missing','overlap','conflict','hash','quota','cancel','maximum','final-hash','utf8'] as const)('durable receiver chunk staging: %s',mode=>{
 const root=mkdtempSync(join(tmpdir(),'receiver-chunks-')),options={root,receiverId:'receiver1',receiverInstanceEpoch:1,clock:()=>({domainId:'clock1',qualificationEpoch:1,lowerBound:1500,upperBound:1500,evidenceHash:'a'.repeat(64)})};let store=new VerificationReceiverStore(options);
 const payload=(mode==='utf8'?'中':'x').repeat(mode==='maximum'?32*1024**2:1024**2+17),tuple=fixture(mode==='final-hash'?'different':payload),fullTupleHash=hashVerificationTuple(tuple),bytes=Buffer.from(payload);
 const chunk=(offset:number,body=bytes.subarray(offset,Math.min(offset+256*1024,bytes.length)),totalBytes=bytes.length,t=tuple)=>({tuple:t,fullTupleHash:hashVerificationTuple(t),totalBytes,offset,chunkHash:createHash('sha256').update(body).digest('hex'),bytes:body});
 try{
  const first=chunk(0);const ack=store.uploadChunk(first);expect(ack.receivedBytes).toBe(first.bytes.length);expect(store.uploadChunk(first)).toEqual(ack);expect(store.query(tuple,fullTupleHash)).toBeUndefined();
  if(mode==='reopen'){store.close();store=new VerificationReceiverStore(options);expect(store.uploadChunk(first)).toEqual(ack);}
  if(mode==='missing'){expect(()=>store.finishUpload(tuple,fullTupleHash)).toThrow();return;}
  if(mode==='overlap'){expect(()=>store.uploadChunk(chunk(1))).toThrow();return;}
  if(mode==='conflict'){expect(()=>store.uploadChunk(chunk(0,Buffer.from('different')))).toThrow();return;}
  if(mode==='hash'){expect(()=>store.uploadChunk({...chunk(first.bytes.length),chunkHash:'f'.repeat(64)})).toThrow();return;}
  if(mode==='quota'){const other={...tuple,operationId:'another'};expect(()=>store.uploadChunk(chunk(0,Buffer.alloc(256*1024,120),32*1024**2,other))).toThrow();return;}
  if(mode==='cancel'){expect(store.cancel(tuple,fullTupleHash).status).toBe('cancelled');expect(()=>store.uploadChunk(chunk(first.bytes.length))).toThrow();expect(store.finishUpload(tuple,fullTupleHash).status).toBe('cancelled');expect(store.readVisible(tuple.operationId)).toBeUndefined();return;}
  for(let offset=first.bytes.length;offset<bytes.length;offset+=256*1024)store.uploadChunk(chunk(offset));
  if(mode==='final-hash'){expect(()=>store.finishUpload(tuple,fullTupleHash)).toThrow('receiver_upload_payload');expect(store.query(tuple,fullTupleHash)).toBeUndefined();return;}
  expect(store.finishUpload(tuple,fullTupleHash).status).toBe('prepared');expect(store.finishUpload(tuple,fullTupleHash).status).toBe('prepared');
  expect(store.commit(tuple,fullTupleHash,1).status).toBe('committed');expect(store.readVisible(tuple.operationId)).toBe(payload);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

it('registration persists the exact tuple with an unbound total; references never create state',()=>{
 const root=mkdtempSync(join(tmpdir(),'receiver-registration-')),options={root,receiverId:'receiver1',receiverInstanceEpoch:1,clock:()=>({domainId:'clock1',qualificationEpoch:1,lowerBound:1500,upperBound:1500,evidenceHash:'a'.repeat(64)})};let store=new VerificationReceiverStore(options);
 const tuple=fixture('hello'),hash=hashVerificationTuple(tuple);
 try{
  expect(store.resolveRegisteredTuple(tuple.operationId,hash)).toBeUndefined();
  expect(()=>store.resolveRegisteredTuple('bad\n',hash)).toThrow();
  expect(store.registerUpload(tuple)).toEqual({fullTupleHash:hash,totalBytes:0,receivedBytes:0});
  expect(()=>store.finishUpload(tuple,hash)).toThrow('incomplete');
  store.close();store=new VerificationReceiverStore(options);
  expect(store.resolveRegisteredTuple(tuple.operationId,hash)).toEqual(tuple);
  expect(()=>store.resolveRegisteredTuple(tuple.operationId,'f'.repeat(64))).toThrow();
  const bytes=Buffer.from('hello');store.uploadChunk({tuple,fullTupleHash:hash,totalBytes:5,offset:0,chunkHash:createHash('sha256').update(bytes).digest('hex'),bytes});
  expect(store.finishUpload(tuple,hash).status).toBe('prepared');
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
