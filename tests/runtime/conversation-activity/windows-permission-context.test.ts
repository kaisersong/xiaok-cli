import { afterEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makePrivateTestTempDir } from '../../support/private-temp.js';
const fault=vi.hoisted(()=>({verify:false,close:false,closeCalls:0,order:[] as string[],error:undefined as unknown,contexts:[] as Array<{close():void}>}));
vi.mock('../../../src/runtime/conversation-activity/storage-permissions.js',async original=>{
 const actual=await original<typeof import('../../../src/runtime/conversation-activity/storage-permissions.js')>();
 return {...actual,createActivityFilePermissions(file:string){
  const context=actual.createActivityFilePermissions(file);fault.contexts.push(context);
  return {verify(){const result=context.verify();if(fault.verify)throw fault.error;return result;},close(){fault.order.push('metadata');fault.closeCalls++;if(fault.close)throw fault.error;context.close();}};
 }};
});
import { ConversationActivityStore } from '../../../src/runtime/conversation-activity/store.js';
const roots:string[]=[],handles=new Set<DatabaseSync>(),closedHandles=new Set<DatabaseSync>();
const originalClose=DatabaseSync.prototype.close;
afterEach(()=>{
 vi.restoreAllMocks();fault.verify=false;fault.close=false;
 for(const context of fault.contexts.splice(0))context.close();
 for(const handle of handles)if(!closedHandles.has(handle))originalClose.call(handle);
 handles.clear();closedHandles.clear();fault.order=[];
 for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});
 fault.closeCalls=0;
});
function fixture(){const root=makePrivateTestTempDir(join(tmpdir(),'activity-context-fault-'));roots.push(root);return join(root,'activity.sqlite');}
function sameThrow(fn:()=>unknown,error:unknown){let threw=false;try{fn();}catch(actual){threw=true;expect(actual).toBe(error);}expect(threw).toBe(true);}
function observeClose(){
 const exec=DatabaseSync.prototype.exec;
 vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,sql:string){handles.add(this);return exec.call(this,sql);});
 const closed:DatabaseSync[]=[];
 vi.spyOn(DatabaseSync.prototype,'close').mockImplementation(function(this:DatabaseSync){closed.push(this);fault.order.push('sqlite');const result=originalClose.call(this);closedHandles.add(this);return result;});
 return closed;
}
it.skipIf(process.platform!=='win32')('retains the actual owner lock after metadata close fails and never retries or acknowledges it',()=>{
 const file=fixture(),closed=observeClose(),store=new ConversationActivityStore(file);
 fault.close=true;fault.error=undefined;const before=fault.closeCalls;
 sameThrow(()=>store.close(),undefined);expect(fault.closeCalls).toBe(before+1);expect(closed).toHaveLength(1);
 sameThrow(()=>store.close(),undefined);expect(fault.closeCalls).toBe(before+1);
 expect(()=>new ConversationActivityStore(file)).toThrow('conversation_activity_owner_held');
 // afterEach releases captured real handles only after these owner-lock assertions.
});
it.skipIf(process.platform!=='win32')('closes installed metadata before SQLite and releases the owner only after both actual closes',()=>{
 const file=fixture();observeClose();
 const store=new ConversationActivityStore(file);fault.order=[];
 store.close();expect(fault.closeCalls).toBe(1);expect(fault.order).toEqual(['metadata','sqlite','sqlite']);
 const reopened=new ConversationActivityStore(file);reopened.close();
});

it.skipIf(process.platform!=='win32')('retains constructor-owned metadata and the owner on a partial verification and close failure',()=>{
 const file=fixture();observeClose();fault.verify=true;fault.close=true;fault.error=new Error('injected-context-failure');
 sameThrow(()=>new ConversationActivityStore(file),fault.error);expect(fault.closeCalls).toBe(1);
 expect(()=>new ConversationActivityStore(file)).toThrow('conversation_activity_owner_held');
});
