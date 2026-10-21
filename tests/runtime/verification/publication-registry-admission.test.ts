import {it,expect} from 'vitest';
import {startControllerIpc,callControllerIpc} from '../../../src/runtime/verification/controller-ipc.js';
import {createPublicationReviewRegistry} from '../../../src/runtime/verification/publication-review-registry.js';
import {parseVerificationTuple,hashVerificationTuple,canonicalVerificationJson as json}from '../../../src/runtime/verification/protocol.js';
import{mkdtempSync,rmSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';
it('retains actual broker IPC admission while four consumed registry requests await native drain, even after disconnect',async()=>{
 const root=mkdtempSync(join(tmpdir(),'publication-admission-')),socketPath=join(root,'s.sock'),peer={uid:501,gid:501,pid:123,auditSessionId:7};
 const registry=createPublicationReviewRegistry({now:()=>100,observe:async()=> '1:1'}),h='a'.repeat(64);
 const tuple=parseVerificationTuple({schemaVersion:1,profileId:'p',ownerKind:'task',ownerId:'o',migrationEpoch:1,expectedBusinessRevision:1,obligationSetRevision:1,obligationSetHash:h,obligations:[{obligationId:'check',predicateId:'original',predicateVersion:'1',definitionHash:h,activeAttemptId:'attempt',attemptEpoch:1,sourceRunId:'run',runNonce:'nonce',subjectId:'subject',contentRoot:h,coreId:'core',coreHash:h,coreFinalRevision:1,proofId:'proof',proofHash:h,proofRevision:1,requiredScopeId:'scope',scopeRevision:1,invalidationEpoch:1}],operationId:'op',immutablePayloadHash:h,receiverId:'receiver',receiverProtocolVersion:1,receiverInstanceEpoch:1,reservationId:'r',nonce:'n',notBefore:100,validUntil:1000000,clockDomainId:'clock',clockQualificationEpoch:1});
 let count=0,ready!:()=>void,release!:()=>void;const allStarted=new Promise<void>(r=>ready=r),held=new Promise<void>(r=>release=r);
 const server=await startControllerIpc({socketPath,requestTimeoutMs:2000,acceptPeer:()=>peer,dispatch:async(body)=>{const request=JSON.parse(body.toString());if(request.schemaVersion===1)return Buffer.from(json(await registry.register(request,peer)));await registry.consume(request.ticket,request.fullTupleHash,peer);if(++count===4)ready();await held;return Buffer.from('done');}});
 const abort=new AbortController(),requests:Promise<unknown>[]=[];
 try{for(let i=0;i<4;i++){const ticket=await registry.register(tuple,peer);requests.push(callControllerIpc(socketPath,Buffer.from(json(ticket)),{signal:abort.signal}).catch(()=>undefined));}
 await allStarted;await expect(callControllerIpc(socketPath,Buffer.from(json(tuple)))).rejects.toThrow();abort.abort();await Promise.all(requests);await expect(callControllerIpc(socketPath,Buffer.from(json(tuple)))).rejects.toThrow();expect(count).toBe(4);release();
 }finally{release();await Promise.all(requests);registry.close();await server.close();rmSync(root,{recursive:true,force:true});}
});
