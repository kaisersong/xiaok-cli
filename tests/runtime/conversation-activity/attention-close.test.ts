import {afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {closeConversationActivity} from '../../../src/runtime/conversation-activity/close.js';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';
import {ConversationActivityService} from '../../../src/runtime/conversation-activity/service.js';
function gate(){let resolve!:()=>void,reject!:(error:unknown)=>void;const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
describe('original activity close composition',()=>{
 const cleanup:Array<()=>void>=[];afterEach(()=>{for(const close of cleanup.splice(0).reverse())close();});
 function fixture(){const root=mkdtempSync(join(tmpdir(),'attention-close-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const store=new ConversationActivityStore(join(root,'activity.sqlite'));cleanup.push(()=>store.close());const service=new ConversationActivityService({store,actorId:'user',profileId:'profile',getThread:()=>null,canObserveWork:()=>false});return{store,service};}
 it('holds the original database until an existing presentation tail actually settles',async()=>{
  const f=fixture(),tail=gate(),closed=vi.spyOn(f.store,'close');const pending=closeConversationActivity({...f,presentationTails:[tail.promise]});await Promise.resolve();await Promise.resolve();expect(closed).not.toHaveBeenCalled();expect(f.store.listWatches()).toEqual([]);tail.resolve();await pending;expect(closed).toHaveBeenCalledOnce();
 });
 it('preserves a real rejected presentation tail and keeps the original database open',async()=>{
  const f=fixture(),tail=gate(),closed=vi.spyOn(f.store,'close'),error=Error('original presentation failure');const pending=closeConversationActivity({...f,presentationTails:[tail.promise]});void pending.catch(()=>{});tail.reject(error);const failure=await pending.catch(value=>value);expect(failure).toBeInstanceOf(AggregateError);expect(failure.errors).toContain(error);expect(closed).not.toHaveBeenCalled();expect(f.store.listWatches()).toEqual([]);
 });
});
