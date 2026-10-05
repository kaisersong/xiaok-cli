import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {VerificationReceiverStore} from '../../src/runtime/verification/receiver-store.js';
import {startReceiverService} from '../../src/runtime/verification/receiver-service.js';
import {createReceiverTransport} from '../../src/runtime/verification/receiver-transport.js';
import {createReceiverReplyVerifier} from '../../src/runtime/verification/receiver-authentication.js';
import {createReceiverUploadVerifier} from '../../src/runtime/verification/receiver-upload-authentication.js';
import {publicationReviewBytes} from '../../src/runtime/verification/publication-operation-review.js';
import {createApprovedPublicationOperations} from '../../src/runtime/verification/approved-publication-operation.js';
import type {verifiedOperationFixture} from './verified-operation-fixture.js';

/** Real signed receiver and publication authority; only native approval and OS
 * peer identity are fixture leaves. Never an installed qualification claim. */
export async function loopPublicationReceiver(f:Awaited<ReturnType<typeof verifiedOperationFixture>>,options:{afterQuery?():void}={}){
 const identity=f.receiverIdentity,socketPath=join(f.root,'publication-receiver.sock');
 const store=new VerificationReceiverStore({root:join(f.root,'publication-receiver'),...identity,clock:f.clock});
 const service=await startReceiverService({socketPath,controllerServiceUid:501,identity,privateKey:f.keys.privateKey,store,assertCurrent(){},readPeer:()=>({...f.peer,pid:123})});
 const transport=createReceiverTransport({socketPath,receiverServiceUid:700,identity,verifier:createReceiverReplyVerifier({...identity,publicKey:f.keys.publicKey}),uploadVerifier:createReceiverUploadVerifier({...identity,publicKey:f.keys.publicKey}),assertCurrent(){},readPeer:()=>({uid:700,gid:700,auditSessionId:1,pid:234})});
 let approvals=0;
 const publication=createApprovedPublicationOperations({database:f.database,authorityId:'authority',completion:f.composition,verification:f.operations,receiverIdentity:identity,receiver:{stagePayload:transport.stagePayload.bind(transport),async call(...args:Parameters<typeof transport.call>){const result=await transport.call(...args);if(args[0]==='query')options.afterQuery?.();return result;}},clock:f.clock,assertCurrent(){},
 resolvePrincipal:p=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid' as const}),
 async approve(review){approvals++;return {version:1,purpose:'completion-publication',authorityId:review.authorityId,challengeId:review.challengeId,uid:review.principal.uid,accountGeneration:review.principal.accountGeneration,auditSessionId:review.principal.auditSessionId,requestSource:review.requestSource,fullReviewHash:createHash('sha256').update(publicationReviewBytes(review)).digest('hex')};}});
 return {publication,store,get approvals(){return approvals;},async close(){await publication.close();await service.close();store.close();}};
}
