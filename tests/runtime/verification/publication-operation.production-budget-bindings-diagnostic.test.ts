import '../../support/installed-controller-fixture.js';
import {readPublishedArtifact} from '../../../src/runtime/verification/published-artifact-reader.js';
import {createPublicationClient} from '../../../src/runtime/verification/publication-client.js';
import {createAuthenticatedControllerClient} from '../../../src/runtime/verification/controller-client.js';
import {startPublicController} from '../../../src/runtime/verification/controller-public-daemon.js';
import {callControllerIpc} from '../../../src/runtime/verification/controller-ipc.js';
import {it,expect,vi} from 'vitest';
import {join} from 'node:path';
import {Session as InspectorSession} from 'node:inspector';
import {createHash} from 'node:crypto';
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
import {VerificationReceiverStore} from '../../../src/runtime/verification/receiver-store.js';
import {startReceiverService} from '../../../src/runtime/verification/receiver-service.js';
import {createReceiverTransport} from '../../../src/runtime/verification/receiver-transport.js';
import {createReceiverReplyVerifier} from '../../../src/runtime/verification/receiver-authentication.js';
import {createReceiverUploadVerifier} from '../../../src/runtime/verification/receiver-upload-authentication.js';
import {publicationReviewBytes} from '../../../src/runtime/verification/publication-operation-review.js';
import {createApprovedPublicationOperations} from '../../../src/runtime/verification/approved-publication-operation.js';
it('rejects copied or foreign actual verification assembly before creating publication state',async()=>{
 const a=await verifiedOperationFixture(),b=await verifiedOperationFixture();
 try{for(const verification of [{...a.operations},b.operations]){
  expect(()=>createApprovedPublicationOperations({database:a.database,authorityId:'authority',completion:a.composition,verification,receiverIdentity:{receiverId:'receiver',receiverInstanceEpoch:1,keyId:'receiver'},receiver:{async stagePayload(){throw Error('unused');},async call(){throw Error('unused');}},clock:a.clock,assertCurrent(){},resolvePrincipal:p=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid'}),async approve(){throw Error('unused');}})).toThrow('publication_verification_binding');
  expect(a.database.prepare('SELECT COUNT(*) n FROM publication_operations').get()).toEqual({n:0});
 }}finally{await a.close();await b.close();}
});
it('rejects a copied completion wrapper with a substituted public dispatcher',async()=>{
 const f=await verifiedOperationFixture();let calls=0;
 try{expect(()=>createApprovedPublicationOperations({database:f.database,authorityId:'authority',completion:{...f.composition,public:{invoke(){calls++;throw Error('foreign public dispatcher');}}},verification:f.operations,receiverIdentity:{receiverId:'receiver',receiverInstanceEpoch:1,keyId:'receiver'},receiver:{async stagePayload(){throw Error('unused');},async call(){throw Error('unused');}},clock:f.clock,assertCurrent(){},resolvePrincipal:p=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid'}),async approve(){throw Error('unused');}})).toThrow('publication_completion_binding');expect(calls).toBe(0);expect(f.database.prepare('SELECT COUNT(*) n FROM publication_operations').get()).toEqual({n:0});}
 finally{await f.close();}
});
