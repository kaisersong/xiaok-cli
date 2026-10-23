import '../../support/installed-controller-fixture.js';
import {expect,it} from 'vitest';
import {join} from 'node:path';
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
import {createApprovedPublicationOperations} from '../../../src/runtime/verification/approved-publication-operation.js';
import {createReceiverTransport} from '../../../src/runtime/verification/receiver-transport.js';
import {createReceiverReplyVerifier} from '../../../src/runtime/verification/receiver-authentication.js';
import {createReceiverUploadVerifier} from '../../../src/runtime/verification/receiver-upload-authentication.js';
it('rejects a real foreign verification factory before it can persist foreign payload outside the local transaction',async()=>{
 const a=await verifiedOperationFixture(),b=await verifiedOperationFixture();
 const identity={receiverId:'receiver',receiverInstanceEpoch:1,keyId:'receiver'};
 const receiver=createReceiverTransport({socketPath:join(a.root,'unused.sock'),receiverServiceUid:700,identity,verifier:createReceiverReplyVerifier({...identity,publicKey:a.keys.publicKey}),uploadVerifier:createReceiverUploadVerifier({...identity,publicKey:a.keys.publicKey}),assertCurrent(){},readPeer(){throw Error('no RPC may occur');}});
 let operations:ReturnType<typeof createApprovedPublicationOperations>|undefined;
 try{
  const count=()=> (b.database.prepare('SELECT COUNT(*) n FROM verified_publication_payloads').get() as {n:number}).n;
  const before=count();let rejected=false;
  try{
   operations=createApprovedPublicationOperations({database:a.database,authorityId:'authority',completion:a.composition,verification:b.operations,receiverIdentity:identity,receiver,clock:a.clock,assertCurrent(){},resolvePrincipal:p=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid'}),async approve(){throw Error('no approval may occur');}});
   operations.prepare({ownerKind:'task',ownerId:'task',requestSource:'agent'},a.peer);
  }catch{rejected=true;}
  expect(rejected).toBe(true);
  expect(count(),'foreign actual payload must not escape the local rollback').toBe(before);
 }finally{await operations?.close();await receiver.close();await a.close();await b.close();}
});
