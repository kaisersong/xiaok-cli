import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,chmodSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {ContinuityService} from '../../electron/context-continuity/service.js';
import {CliArchiveImporter} from '../../electron/context-continuity/cli-archive.js';
import {registerContextContinuityIpc} from '../../electron/context-continuity/ipc.js';
import {resetIpcSchemaRegistryForTests} from '../../electron/ipc-runtime.js';
import {DesktopShutdownGate,ShutdownAwareIpcMain} from '../../electron/shutdown-aware-ipc-main.js';
const cleanup:Array<()=>void>=[];afterEach(()=>{cleanup.splice(0).reverse().forEach(f=>f());resetIpcSchemaRegistryForTests();});
async function setup(){
 resetIpcSchemaRegistryForTests();const root=mkdtempSync(join(tmpdir(),'cli-archive-ipc-')),sessions=join(root,'sessions'),store=new FileSessionStore(sessions);
 const service=new ContinuityService({dbPath:join(root,'store.sqlite'),profileId:'p'}),actor={requestSource:'user' as const,profileId:'p',actorId:'desktop-user:p'};
 cleanup.push(()=>rmSync(root,{recursive:true,force:true}),()=>service.close());
 await store.save({sessionId:'s',cwd:root,createdAt:1,updatedAt:2,lineage:['s'],messages:[{role:'user',content:[{type:'text',text:'CLI_IPC_CANARY'}]}],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
 const cliArchive=new CliArchiveImporter(service,actor,sessions),handlers=new Map<string,(event:unknown,value:unknown)=>Promise<unknown>>(),gate=new DesktopShutdownGate();
 const port={service,actor,cliArchive};let trusted=true;
 registerContextContinuityIpc(new ShutdownAwareIpcMain({handle:(channel,fn)=>handlers.set(channel,fn as never)},gate),()=>port,()=>trusted);
 const call=(name:string,value:unknown)=>handlers.get('desktop:context:'+name)!({},value);
 return {root,sessions,path:join(sessions,'s.json'),service,actor,cliArchive,port,gate,call,untrust:()=>{trusted=false;}};
}
it('round trips fixed-root CLI archive through actual shutdown-aware semantic IPC',async()=>{
 const f=await setup();expect(await f.call('listCliArchives',{})).toMatchObject({items:[{sessionId:'s',available:true}]});
 const p=await f.call('previewCliArchive',{sessionId:'s',operationId:'p'}) as {previewId:string;manifestHash:string};
 const claimed=await f.call('claimCliArchive',{previewId:p.previewId,manifestHash:p.manifestHash,operationId:'c'}) as {conversationId:string};
 const found=await f.call('searchHistory',{query:'CLI_IPC_CANARY'}) as {hits:Array<{conversationId:string}>};expect(found.hits[0].conversationId).toBe(claimed.conversationId);expect(f.gate.outstanding).toBe(0);
});
it('rejects renderer path, forged actor and untrusted sender on all import channels',async()=>{
 const f=await setup();
 for(const [name,input] of [['listCliArchives',{}],['previewCliArchive',{sessionId:'s',operationId:'p'}],['claimCliArchive',{previewId:'p',manifestHash:'h',operationId:'c'}]] as const){
  await expect(f.call(name,{...input,path:f.sessions})).rejects.toThrow();await expect(f.call(name,{...input,actor:f.actor})).rejects.toThrow();
 }
 f.untrust();await expect(f.call('listCliArchives',{})).rejects.toThrow('not_readable');expect(f.service.listConversations(f.actor)).toEqual([]);
});
it('denies preview bytes changed after the actual inner IPC fence and before outer registrar handoff',async()=>{
 const f=await setup(),original=f.cliArchive.assertReply.bind(f.cliArchive);let checks=0;
 vi.spyOn(f.cliArchive,'assertReply').mockImplementation((result,actor)=>{checks++;original(result,actor);if(checks===3)queueMicrotask(()=>chmodSync(f.path,0o666));});
 await expect(f.call('previewCliArchive',{sessionId:'s',operationId:'p'})).rejects.toThrow('cli_source_unavailable');expect(checks).toBeGreaterThanOrEqual(4);expect(f.gate.outstanding).toBe(0);
});
it('denies committed claim output if its original canonical source is blocked at final handoff',async()=>{
 const f=await setup(),p=await f.call('previewCliArchive',{sessionId:'s',operationId:'p'}) as {previewId:string;manifestHash:string};
 const original=f.cliArchive.assertReply.bind(f.cliArchive);let checks=0;
 vi.spyOn(f.cliArchive,'assertReply').mockImplementation((result,actor)=>{checks++;original(result,actor);if(checks===3)queueMicrotask(()=>f.service.setScopePolicy(()=>'blocked'));});
 await expect(f.call('claimCliArchive',{previewId:p.previewId,manifestHash:p.manifestHash,operationId:'c'})).rejects.toThrow('not_readable');expect(checks).toBeGreaterThanOrEqual(4);
});
it('rechecks actual sender identity at the final registrar handoff',async()=>{
 const f=await setup(),original=f.cliArchive.assertReply.bind(f.cliArchive);let checks=0;
 vi.spyOn(f.cliArchive,'assertReply').mockImplementation((result,actor)=>{checks++;original(result,actor);if(checks===3)queueMicrotask(f.untrust);});
 await expect(f.call('listCliArchives',{})).rejects.toThrow('not_readable');expect(f.gate.outstanding).toBe(0);
});
