import '../../support/installed-controller-fixture.js';
import {readPublishedArtifact} from '../../../src/runtime/verification/published-artifact-reader.js';
import {createPublicationClient} from '../../../src/runtime/verification/publication-client.js';
import {createAuthenticatedControllerClient} from '../../../src/runtime/verification/controller-client.js';
import {startPublicController} from '../../../src/runtime/verification/controller-public-daemon.js';
import {callControllerIpc} from '../../../src/runtime/verification/controller-ipc.js';
import {it,expect} from 'vitest';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
import {VerificationReceiverStore} from '../../../src/runtime/verification/receiver-store.js';
import {startReceiverService} from '../../../src/runtime/verification/receiver-service.js';
import {createReceiverTransport} from '../../../src/runtime/verification/receiver-transport.js';
import {createReceiverReplyVerifier} from '../../../src/runtime/verification/receiver-authentication.js';
import {createReceiverUploadVerifier} from '../../../src/runtime/verification/receiver-upload-authentication.js';
import {publicationReviewBytes} from '../../../src/runtime/verification/publication-operation-review.js';
import {createApprovedPublicationOperations} from '../../../src/runtime/verification/approved-publication-operation.js';
it.each(['principal','revision','deadline','frozen-body'] as const)('revalidates each real upload socket while keeping captured bytes: %s',async mode=>{
 const f=await verifiedOperationFixture('large-artifact'),identity=f.receiverIdentity,socketPath=join(f.root,'receiver.sock');
 const store=new VerificationReceiverStore({root:join(f.root,'receiver-state'),...identity,clock:f.clock});
 const service=await startReceiverService({socketPath,controllerServiceUid:501,identity,privateKey:f.keys.privateKey,store,assertCurrent(){},readPeer:()=>({...f.peer,pid:123})});
 const transport=createReceiverTransport({socketPath,receiverServiceUid:700,identity,verifier:createReceiverReplyVerifier({...identity,publicKey:f.keys.publicKey}),uploadVerifier:createReceiverUploadVerifier({...identity,publicKey:f.keys.publicKey}),assertCurrent(){},readPeer:()=>({uid:700,gid:700,auditSessionId:1,pid:234})});
 let changed=false,beforeSends=0,originalBody:Buffer|undefined;
 const operations=createApprovedPublicationOperations({database:f.database,authorityId:'authority',completion:f.composition,verification:f.operations,receiverIdentity:identity,
  receiver:{call:transport.call,async stagePayload(...args:Parameters<typeof transport.stagePayload>){
   const before=args[3];args[3]=()=>{
    if(++beforeSends===3){
     if(mode==='principal')changed=true;
     if(mode==='revision')f.database.prepare('UPDATE verification_owners SET business_revision=business_revision+1').run();
     if(mode==='deadline')f.setTime(999999);
     if(mode==='frozen-body'){
      originalBody=Buffer.from(args[1]);
      f.database.prepare('UPDATE verified_publication_payloads SET payload=?').run(Buffer.alloc(originalBody.length,120));
     }
    }
    before?.();
   };
   const result=await transport.stagePayload(...args);
   if(mode==='frozen-body')f.database.prepare('UPDATE verified_publication_payloads SET payload=?').run(originalBody!);
   return result;
  }},clock:f.clock,assertCurrent(){},resolvePrincipal:p=>({...p,accountGeneration:changed?'22222222-AAAA-BBBB-CCCC-555555555555':'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid'}),
  async approve(review){return {version:1,purpose:'completion-publication',authorityId:review.authorityId,challengeId:review.challengeId,uid:review.principal.uid,accountGeneration:review.principal.accountGeneration,auditSessionId:review.principal.auditSessionId,requestSource:review.requestSource,fullReviewHash:createHash('sha256').update(publicationReviewBytes(review)).digest('hex')};}});
 try{
  const ticket=operations.prepare({ownerKind:'task',ownerId:'task',requestSource:'agent'},f.peer);
  const pending=operations.approve({challengeId:ticket.challengeId},f.peer,new AbortController().signal);
  if(mode==='frozen-body'){
   const result=await pending;expect(result.status).toBe('committed');expect(Buffer.from(store.readVisible(result.operationId)!)).toEqual(originalBody);
  }else{await expect(pending).rejects.toThrow();expect(beforeSends).toBe(3);}
 }finally{await operations.close();await transport.close();await service.close();store.close();await f.close();}
},120000);
