import {it,expect} from 'vitest';
import {createPublicationReviewRegistry} from '../../../src/runtime/verification/publication-review-registry.js';
import {parseVerificationTuple,hashVerificationTuple} from '../../../src/runtime/verification/protocol.js';
const peer={uid:501,gid:501,pid:123,auditSessionId:7};
function tuple(){const h='a'.repeat(64);return parseVerificationTuple({schemaVersion:1,profileId:'p',ownerKind:'task',ownerId:'o',migrationEpoch:1,expectedBusinessRevision:1,obligationSetRevision:1,obligationSetHash:h,obligations:[{obligationId:'check',predicateId:'original',predicateVersion:'1',definitionHash:h,activeAttemptId:'attempt',attemptEpoch:1,sourceRunId:'run',runNonce:'nonce',subjectId:'subject',contentRoot:h,coreId:'core',coreHash:h,coreFinalRevision:1,proofId:'proof',proofHash:h,proofRevision:1,requiredScopeId:'scope',scopeRevision:1,invalidationEpoch:1}],operationId:'op',immutablePayloadHash:h,receiverId:'receiver',receiverProtocolVersion:1,receiverInstanceEpoch:1,reservationId:'r',nonce:'n',notBefore:100,validUntil:1000000,clockDomainId:'clock',clockQualificationEpoch:1});}
it('binds exact tuple, peer and original process instance; consumes before asynchronous observation',async()=>{
 let now=100,start='1:1',hold:Promise<void>|undefined;const registry=createPublicationReviewRegistry({now:()=>now,observe:async()=>{await hold;return start;}}),t=tuple(),hash=hashVerificationTuple(t);
 const first=await registry.register(t,peer);expect(first.fullTupleHash).toBe(hash);
 let release!:()=>void;hold=new Promise<void>(r=>release=r);const pending=registry.consume(first.ticket,hash,peer);
 await expect(registry.consume(first.ticket,hash,peer)).rejects.toThrow();release();expect(await pending).toEqual(t);hold=undefined;
 const second=await registry.register(t,peer);start='2:1';await expect(registry.consume(second.ticket,hash,peer)).rejects.toThrow();
 const third=await registry.register(t,peer);await expect(registry.consume(third.ticket,hash,{...peer,auditSessionId:8})).rejects.toThrow();
 const fourth=await registry.register(t,peer);now+=300001;await expect(registry.consume(fourth.ticket,hash,peer)).rejects.toThrow();
});
it('bounds pending registration, retires expired entries, and rejects a restarted registry ticket',async()=>{
 let now=100;const ports={now:()=>now,observe:async()=> '1:1'},r=createPublicationReviewRegistry(ports),t=tuple();
 const tickets=[];for(let i=0;i<4;i++)tickets.push(await r.register(t,peer));await expect(r.register(t,peer)).rejects.toThrow();
 await expect(createPublicationReviewRegistry(ports).consume(tickets[0].ticket,hashVerificationTuple(t),peer)).rejects.toThrow();
 now+=300001;expect(await r.register(t,peer)).toHaveProperty('ticket');r.close();await expect(r.register(t,peer)).rejects.toThrow();
});
it('assembles the original near-limit review through real bounded IPC registration and a small one-use metadata request',async()=>{
 const {startControllerIpc,callControllerIpc}=await import('../../../src/runtime/verification/controller-ipc.js');
 const {consumePublicationReview}=await import('../../../src/runtime/verification/publication-review-registry.js');
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {canonicalVerificationJson:json}=await import('../../../src/runtime/verification/protocol.js');
 const root=mkdtempSync(join(tmpdir(),'publication-registry-')),socketPath=join(root,'s.sock'),registry=createPublicationReviewRegistry({now:()=>100,observe:async()=> '1:1'});
 const t={...tuple()},original=t.obligations[0];t.obligations=Array.from({length:256},(_,i)=>({...original,...Object.fromEntries(['obligationId','predicateId','predicateVersion','activeAttemptId','sourceRunId','runNonce','subjectId','coreId','proofId','requiredScopeId'].map(k=>[k,String(i).padStart(3,'0')+'x'.repeat(47)+'\\'.repeat(110)])),kind:'inherited' as const,originOwner:{profileId:t.profileId,ownerKind:'task' as const,ownerId:'y'.repeat(160)},originalObligationId:String(i).padStart(3,'0')+'x'.repeat(47)+'\\'.repeat(110)}));
 const metadata={version:1,purpose:'completion-publication',authorityId:'authority',challengeId:'challenge',principal:{uid:501,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',auditSessionId:7},requestSource:'user',deadline:{domainId:t.clockDomainId,qualificationEpoch:1,notBefore:100,validUntil:1000}};
 const server=await startControllerIpc({socketPath,acceptPeer:()=>peer,dispatch:async(bytes,_signal,actualPeer)=>{const value=JSON.parse(bytes.toString());if(value.schemaVersion===1)return Buffer.from(json(await registry.register(value,actualPeer as typeof peer)));const approved=await consumePublicationReview(registry,value,actualPeer as typeof peer);await approved.assertCaller();expect(approved.review.tuple).toEqual(t);return Buffer.from('ok');}});
 try{const bytes=Buffer.from(json(t));expect(bytes.length).toBeGreaterThan(900000);const registration=JSON.parse((await callControllerIpc(socketPath,bytes)).toString());const request=Buffer.from(json({...registration,metadata}));expect(request.length).toBeLessThan(65536);expect((await callControllerIpc(socketPath,request)).toString()).toBe('ok');await expect(callControllerIpc(socketPath,request)).rejects.toThrow();}finally{registry.close();await server.close();rmSync(root,{recursive:true,force:true});}
});
it('counts registrations awaiting observation and rechecks consumed caller after the GUI interval',async()=>{
 let start='1:1',release!:()=>void;const held=new Promise<void>(r=>release=r);let waiting=true;const registry=createPublicationReviewRegistry({now:()=>100,observe:async()=>{if(waiting)await held;return start;}}),t=tuple();
 const pending=Array.from({length:4},()=>registry.register(t,peer));await expect(registry.register(t,peer)).rejects.toThrow('capacity');waiting=false;release();const tickets=await Promise.all(pending);
 const admitted=await registry.consume(tickets[0].ticket,hashVerificationTuple(t),peer);await registry.assertCaller(admitted,peer);start='2:1';await expect(registry.assertCaller(admitted,peer)).rejects.toThrow('identity');registry.close();
});
