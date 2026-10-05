import '../../support/installed-controller-fixture.js';
import {expect,it} from 'vitest';
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
import {createApprovedPublicationOperations} from '../../../src/runtime/verification/approved-publication-operation.js';
it('does not validate one verification object and dispatch through another getter result',async()=>{
 const a=await verifiedOperationFixture(),b=await verifiedOperationFixture();
 let operations:ReturnType<typeof createApprovedPublicationOperations>|undefined,reads=0,foreignCalls=0;
 try{
  const count=()=> (b.database.prepare('SELECT COUNT(*) n FROM verified_publication_payloads').get() as {n:number}).n;
  const before=count();
  const foreign={stageVerifiedPayload(){foreignCalls++;return b.operations.stageVerifiedPayload(b.owner);}};
  try{
   operations=createApprovedPublicationOperations({database:a.database,authorityId:'authority',completion:a.composition,get verification(){reads++;return reads<=2?foreign:a.operations;},receiverIdentity:{receiverId:'receiver',receiverInstanceEpoch:1,keyId:'receiver'},receiver:{async stagePayload(){throw Error('unused');},async call(){throw Error('unused');}},clock:a.clock,assertCurrent(){},resolvePrincipal:p=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid'}),async approve(){throw Error('unused');}});
   operations.prepare({ownerKind:'task',ownerId:'task',requestSource:'agent'},a.peer);
  }catch{/* A rejected assembly must have no foreign database effects. */}
  expect({foreignCalls,foreignPayloadDelta:count()-before,reads}).toEqual({foreignCalls:0,foreignPayloadDelta:0,reads:1});
 }finally{await operations?.close();await a.close();await b.close();}
});
