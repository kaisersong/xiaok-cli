import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {afterEach,it,expect} from 'vitest';
import {ToolRegistry} from '../../../src/ai/tools/index.js';
import {createWriteTool} from '../../../src/ai/tools/write.js';
import {PermissionManager} from '../../../src/ai/permissions/manager.js';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
import {createCompoundSessionJournal} from '../../../src/runtime/sol-pi/compound-session-journal.js';
import {createCompoundExecutionCoordinator} from '../../../src/runtime/sol-pi/compound-execution-coordinator.js';
const cleanup:Array<()=>void>=[];afterEach(()=>{for(const f of cleanup.splice(0).reverse())f();});
async function setup(){
 const root=mkdtempSync(join(tmpdir(),'compound-child-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const store=new FileSessionStore(root);
 const permission=new PermissionManager({mode:'auto'});const parent=new ToolRegistry({permissionManager:permission},[createWriteTool({cwd:root})]);cleanup.push(()=>parent.dispose());
 async function install(registry:ToolRegistry,sessionIdentity:string){
  const snapshot={sessionId:sessionIdentity,cwd:root,createdAt:1,updatedAt:1,lineage:[],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]};await store.save(snapshot);
  const authority=createSessionExecutionAuthority({root,sessionIdentity,hostContext:createSessionExecutionContext({requestSource:'agent',ownerId:'host',scopeId:'scope'})});cleanup.push(()=>authority.dispose());
  const journal=createCompoundSessionJournal({store,root,sessionIdentity,ownerId:'host',scopeId:'scope',requestSource:'agent',assertCurrent:()=>{}});
  registry.installCompoundExecutionPort(tools=>createCompoundExecutionCoordinator({journal,authority,sessionIdentity,assertCurrent:()=>{},getPermissionRevision:()=>permission.getRevision(),readonlyTools:[],fileTools:tools.filter(t=>t.definition.name==='write')}));
  return{taskId:'task',session:snapshot,messages:[],systemPrompt:'',toolDefinitions:[],hostProviderInvocationId:'provider',toolInvocationId:'tool'};
 }
 await install(parent,'parent');return{root,store,parent,install};
}
it('an explicit child fork cannot execute or prepare before its own host coordinator is installed',async()=>{
 const f=await setup(),child=f.parent.forkForCompoundObservation([],['write']);cleanup.push(()=>child.dispose());const path=join(f.root,'blocked');
 await expect(child.executeTool('write',{file_path:path,content:'bad'})).rejects.toThrow('compound_child_installation_required');
 await expect(child.prepareToolInvocation('write',{file_path:path,content:'bad'})).rejects.toThrow('compound_child_installation_required');
 expect(existsSync(path)).toBe(false);
});
it('a child installs its own real journal and does not reuse the parent session port',async()=>{
 const f=await setup(),child=f.parent.forkForCompoundObservation([],['write']);cleanup.push(()=>child.dispose());const context=await f.install(child,'child'),path=join(f.root,'child-file');
 expect(await child.executeTool('write',{file_path:path,content:'child'},context)).not.toContain('Error:');expect(readFileSync(path,'utf8')).toBe('child');
 expect((await f.store.load('child'))!.compoundOperations!.directOperations).toHaveLength(1);expect((await f.store.load('parent'))!.compoundOperations).toBeUndefined();
});
