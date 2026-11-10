// @vitest-environment node
import {expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ContinuityService} from '../../electron/context-continuity/service.js';
import {captureCanonicalStoreState} from '../../electron/context-continuity/sync-canonical-state.js';

it('keeps ordinary local writes/restart available above the bounded sync snapshot budget',()=>{
 const root=mkdtempSync(join(tmpdir(),'continuity-local-size-')),options={dbPath:join(root,'continuity.sqlite'),profileId:'profile'},actor={requestSource:'user' as const,profileId:'profile',actorId:'desktop-user:profile'};let service:ContinuityService|undefined;
 try{
  service=new ContinuityService(options);const conversation=service.createConversation(actor,{operationId:'local-only'}),text='x'.repeat(6*1024*1024);
  for(let i=0;i<3;i++)expect(()=>service!.recordMessage(actor,{conversationId:conversation.id,sourceKind:'desktop_task',sourceId:'local-original-input',sourceDataEpoch:'epoch',sourceMessageId:'user-'+i,sourceRevision:1,role:'user',text,executionState:'unknown'})).not.toThrow();
  expect(()=>captureCanonicalStoreState(service!.store.db)).toThrow('canonical_store_state_unavailable');service.close();service=undefined;
  service=new ContinuityService(options);expect(service.listMessages(actor,conversation.id).map(message=>message.text.length)).toEqual([text.length,text.length,text.length]);
  expect(()=>service!.updateConversation(actor,conversation.id,{title:'local history remains usable'})).not.toThrow();
 }finally{service?.close();rmSync(root,{recursive:true,force:true});}
});
