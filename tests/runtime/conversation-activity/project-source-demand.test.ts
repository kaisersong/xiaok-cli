import {expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';
import {ConversationActivityService} from '../../../src/runtime/conversation-activity/service.js';
import {ConversationActivitySources} from '../../../src/runtime/conversation-activity/sources.js';
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(yes=>{resolve=yes;});return{resolve,promise};};
it('publishes the original per-project shared read before synchronous permission reentry can start a second pump',async()=>{
 const root=mkdtempSync(join(tmpdir(),'project-source-prefix-')),store=new ConversationActivityStore(join(root,'activity.sqlite'));
 store.prepareAssociation({operationId:'op',creationIdempotencyKey:'op',origin:{profileId:'profile',workspaceId:'workspace',threadId:'thread',actorId:'user'}});
 store.bindWork({operationId:'op',watchId:'watch',source:'kswarm',logicalSourceId:'kswarm',sourceDataEpoch:'epoch',workId:'p'});
 let sources:ConversationActivitySources,reentered=false,nested:Promise<void>|undefined;
 const service=new ConversationActivityService({store,profileId:'profile',actorId:'user',getThread:()=>({profileId:'profile',workspaceId:'workspace',threadId:'thread',deleteState:'none'}),canObserveWork:()=>{if(!reentered){reentered=true;nested=sources.refreshProject('p',true);}return true;}});
 const gate=deferred();let active=0,maximum=0;
 sources=new ConversationActivitySources({store,service,taskHost:()=>{throw Error('not a task source');},readProject:async()=>{active++;maximum=Math.max(maximum,active);try{await gate.promise;return{ok:true,sourceDataEpoch:'epoch',headSeq:0,nextCursor:0,gap:false,snapshot:{status:'active'},events:[]};}finally{active--;}}});
 const first=sources.refreshProject('p');
 try{await vi.waitFor(()=>expect(active).toBeGreaterThan(0));expect(maximum).toBe(1);}
 finally{gate.resolve();await Promise.all([first,nested]);await sources.close();await service.close();store.close();rmSync(root,{recursive:true,force:true});}
});
