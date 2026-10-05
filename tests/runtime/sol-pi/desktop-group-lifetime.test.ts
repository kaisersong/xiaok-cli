import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDesktopObservationGroupLifetime } from '../../../desktop/electron/desktop-observation-group-lifetime.js';
import { createObservationService } from '../../../src/runtime/sol-pi/observation-service.js';
import { createObservationSessionOwner } from '../../../src/runtime/sol-pi/observation-session-owner.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { FileSessionStore } from '../../../src/ai/runtime/session-store/file-store.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { testOnlyCapacity } from '../../support/sol-pi-capacity.js';
import { createProviderDisclosureFetch } from '../../../src/runtime/sol-pi/provider-disclosure.js';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
const cleanup:Array<()=>void|Promise<void>>=[];
afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn();});
function deferred(){let resolve!:()=>void;return {promise:new Promise<void>(done=>resolve=done),resolve:()=>resolve()};}
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'desktop-observation-group-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const service=createObservationService({profileRoot:join(root,'profile'),profileId:'test',redactor:{version:'test',redact:text=>text}});cleanup.push(()=>service.dispose());
 const session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:'root'});
 const caller=service.bindCaller({sessionId:'root',ownerAgentId:'root',scopeId:'root',permissionGeneration:1,surface:'ordinary-owner',requestSource:'agent'});
 const store=new FileSessionStore(join(root,'sessions'));
 const owner=createObservationSessionOwner({service,caller,session,destination:{provider:'test',model:'test',url:'https://example.test/chat/completions'},capacityProfile:testOnlyCapacity('https://example.test/chat/completions','test'),persist:snapshot=>store.save(snapshot)});
 const permissions=new PermissionManager({mode:'auto'});
 const registry=()=>{const value=new ToolRegistry({permissionManager:permissions},[]);cleanup.push(()=>value.dispose());return value;};
 const first=registry(),dispose=vi.fn(()=>{owner.dispose();});
 const group=createDesktopObservationGroupLifetime({owner,registry:first,dispose});cleanup.push(()=>group.dispose());
 return {owner,group,registry,first,dispose,service,root};
}
it('stopping one root turn leaves independently tracked child work alive',async()=>{
 const f=fixture(),rootStop=new AbortController(),childStop=deferred(),entered=deferred();let childSignal!:AbortSignal;
 const child=f.group.runChild(async signal=>{childSignal=signal;entered.resolve();await childStop.promise;return 'child';});await entered.promise;
 await f.group.runRootTurn(f.first,rootStop.signal,async signal=>{rootStop.abort();expect(signal.aborted).toBe(true);});
 expect(childSignal.aborted).toBe(false);expect(f.dispose).not.toHaveBeenCalled();
 childStop.resolve();expect(await child).toBe('child');
 await f.group.runRootTurn(f.registry(),new AbortController().signal,async()=>{expect(f.owner.getMode()).toBe('active');});
});
it('serializes root native-session leases and never enters a second callback before the first drains',async()=>{
 const f=fixture(),entered=deferred(),finish=deferred(),second=vi.fn();
 const one=f.group.runRootTurn(f.first,new AbortController().signal,async()=>{entered.resolve();await finish.promise;});await entered.promise;
 const two=f.group.runRootTurn(f.registry(),new AbortController().signal,async()=>{second();});
 await Promise.resolve();expect(second).not.toHaveBeenCalled();finish.resolve();await Promise.all([one,two]);expect(second).toHaveBeenCalledOnce();
});
it('group revoke aborts all work immediately but disposal waits for actual tracked work to settle',async()=>{
 const f=fixture(),entered=deferred(),finish=deferred();let signal!:AbortSignal;
 const child=f.group.runChild(async actual=>{signal=actual;entered.resolve();await finish.promise;});await entered.promise;
 let disposed=false;const closing=f.group.dispose().then(()=>{disposed=true;});
 expect(signal.aborted).toBe(true);expect(()=>f.owner.getMode()).toThrow();await Promise.resolve();expect(disposed).toBe(false);
 finish.resolve();await child;await closing;expect(f.dispose).toHaveBeenCalledOnce();
});
it('changing permission authority cannot reuse a previous root lease or silently preserve older permission',async()=>{
 const f=fixture();await f.group.runRootTurn(f.first,new AbortController().signal,async()=>{});
 const foreign=new ToolRegistry({permissionManager:new PermissionManager({mode:'default'})},[]);cleanup.push(()=>foreign.dispose());const work=vi.fn();
 await expect(f.group.runRootTurn(foreign,new AbortController().signal,work)).rejects.toThrow(/AUTHORIZATION/);
 expect(work).not.toHaveBeenCalled();expect(f.group.signal.aborted).toBe(true);
});
it('refuses a retired registry even when its permission epoch is unchanged',async()=>{
 const f=fixture();await f.group.runRootTurn(f.first,new AbortController().signal,async()=>{});
 const work=vi.fn();await expect(f.group.runRootTurn(f.first,new AbortController().signal,work)).rejects.toThrow(/AUTHORIZATION/);expect(work).not.toHaveBeenCalled();
});

it('group disposal waits for actual guarded response cancellation, not merely the abort event',async()=>{
 const f=fixture(),cancelled=deferred(),received=deferred();
 const user=f.service.bindCaller({sessionId:'root',ownerAgentId:'root',scopeId:'root',permissionGeneration:1,surface:'ordinary-owner',requestSource:'user'});
 f.service.setArchivePolicy({requestSource:'user',caller:user,policy:{version:1,id:'source',revision:1,scopeId:'root',sourceAdapterId:'native.bash.v1',sourceDescriptors:[JSON.stringify({toolName:'bash',command:'fixture',workdir:f.root})],localPersistence:true,allowUnclassifiedText:true,allowIncomplete:false,expiresAt:Date.now()+60000,destinations:[{provider:'test',model:'test',url:'https://example.test/chat/completions'}]}});
 const capture=f.owner.collectorFor('capture').begin({toolName:'bash',source:{command:'fixture',workdir:f.root}});capture.append('evidence');capture.finalize({executionState:'terminal',outcome:'success'});await f.owner.projectToolResult('capture','evidence');
 const cancel=vi.fn(()=>cancelled.promise);
 const raw=vi.fn(async()=>new Response(new ReadableStream({cancel}),{headers:{'content-type':'text/plain'}}));
 const guarded=createProviderDisclosureFetch(f.owner.prepareProviderDisclosure()!,raw);
 const running=f.group.runRootTurn(f.first,new AbortController().signal,async signal=>{
  const response=await guarded('https://example.test/chat/completions',{method:'POST',body:JSON.stringify({model:'test',messages:[]}),signal});received.resolve();await response.text();
 });
 const outcome=running.catch(()=>{});await received.promise;
 let settled=false;const closing=f.group.dispose().then(()=>{settled=true;});await Promise.resolve();
 expect(cancel).toHaveBeenCalledOnce();expect(settled).toBe(false);expect(f.dispose).not.toHaveBeenCalled();
 cancelled.resolve();await Promise.all([outcome,closing]);expect(raw).toHaveBeenCalledOnce();expect(f.dispose).toHaveBeenCalledOnce();
});

it('holds preparation resources synchronously until the actual admission owner finishes cleanup, including immediate revoke',async()=>{
 const f=fixture();const hold=f.group.holdPreparation();
 const closing=f.group.dispose();await Promise.resolve();await Promise.resolve();
 expect(hold.signal.aborted).toBe(true);expect(f.dispose).not.toHaveBeenCalled();
 hold.release();hold.release();await closing;expect(f.dispose).toHaveBeenCalledOnce();
 expect(()=>f.group.holdPreparation()).toThrow(/AUTHORIZATION/);
});
