import {expect,it} from 'vitest';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';
it('keeps the declared complete-member capacity when a new first alias repeatedly selects the same physical Native inventory',()=>{
 const root=mkdtempSync(join(tmpdir(),'native-alias-capacity-')),store=new ConversationActivityStore(join(root,'activity.sqlite'));
 const reference={sourceKind:'codex_native_approval',taskId:'task',taskSessionId:'session',executionThreadId:'thread',nativeSessionId:'native-session',nativeThreadId:'native-thread',nativeTurnId:'native-turn',nativeGeneration:1,nativeIncarnation:randomUUID()};
 const enrolled:Array<{watchId:string;enrollmentIncarnation:string;bindingDigest:string}>=[];
 try{for(let index=0;index<512;index++){
  const watchId=String(999-index).padStart(3,'0');store.prepareAssociation({operationId:watchId,creationIdempotencyKey:watchId,origin:{profileId:'profile',workspaceId:'workspace',threadId:'thread',actorId:'user'}});store.bindWork({operationId:watchId,watchId,source:'task_host',logicalSourceId:'host',sourceDataEpoch:'session',workId:'task'});const {enrollment,delivery}=store.enrollNativeAttentionSource(watchId,reference);store.revokeNativeAttentionDelivery(delivery);enrolled.push(enrollment);
  const capture=store.captureAttentionRead(watchId);const result=store.finalizeAttentionReadRound(watchId,{expectedMembershipDigest:capture.membershipDigest,expectedProjectionVersion:capture.projectionVersion,expectedPresentationIncarnation:capture.presentationIncarnation,inventories:[...enrolled].sort((a,b)=>a.watchId.localeCompare(b.watchId)).map(item=>({sourceKind:'codex_native_approval',watchId:item.watchId,readerIncarnation:reference.nativeIncarnation,enrollmentIncarnation:item.enrollmentIncarnation,bindingDigest:item.bindingDigest,reference,coverage:'native_approvals_exclusive_execution_v1',inventoryRevision:1,inventoryDigest:'a'.repeat(64),taskStatus:'working',businessOutcome:'unknown',questions:[]}))});
  expect(result.view.projection.executionState).toBe('running');expect(result.view.presentation.questions).toEqual([]);
 }}finally{store.close();rmSync(root,{recursive:true,force:true});}
},120_000);
