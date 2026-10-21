import {afterEach,it,expect} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync,existsSync,readFileSync,realpathSync} from 'node:fs';import {join} from 'node:path';import {homedir,tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';
import {parseObservationPolicyFile,createProductObservationOwner} from '../../../src/runtime/sol-pi/product-bootstrap.js';
import {installProductCompoundCoordinator} from '../../../src/runtime/sol-pi/product-compound-coordinator.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {ToolRegistry,buildToolList} from '../../../src/ai/tools/index.js';import {createWriteTool} from '../../../src/ai/tools/write.js';import {PermissionManager} from '../../../src/ai/permissions/manager.js';
const cleanup:Array<()=>void>=[];afterEach(()=>{for(const f of cleanup.splice(0).reverse())f();});
const environmentRoot=join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1');
const qualified=process.platform==='darwin'&&process.arch==='arm64'&&existsSync(join(environmentRoot,'manifest.json'));
it.skipIf(!qualified)('real product rebind closes old pending approvals before installing a fresh registry on the same authority and journal',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'product-compound-rebind-')));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const file=join(root,'file'),policyFile=join(root,'policy.json');writeFileSync(file,'before');
 writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt:Date.now()+60000,readFileScopes:[{filePath:file,startLine:1}],bashSources:[],compoundExecution:{version:1,mode:'mechanism-experiment'}}));
 const storeRoot=join(root,'sessions'),store=new FileSessionStore(storeRoot),session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:randomUUID(),cwd:root});const permission=new PermissionManager({mode:'default'});
 const product=await createProductObservationOwner({policy:parseObservationPolicyFile(policyFile),session,profileRoot:join(root,'profile'),environmentRoot,credentialSecrets:[],persist:s=>store.save(s),permissionManager:permission,executionPersistence:{store,root:storeRoot}});
 let entered!:()=>void;const asked=new Promise<void>(r=>entered=r);let prompts=0;
 const base=new ToolRegistry({permissionManager:permission,onPrompt:async()=>{if(++prompts===1){entered();return new Promise<boolean>(()=>{});}return true;}},buildToolList(undefined,{cwd:root}).filter(t=>t.definition.name==='write'));
 const original=base.forkForCompoundObservation([],['write']);
 const coordinator=await installProductCompoundCoordinator({product,session,store,root:storeRoot,registry:original});
 try{
  await expect((coordinator as any).prepareManagedChild({preparation:{},childSession:new AgentSessionState()})).rejects.toThrow('compound_managed_invocation_required');
  const context={taskId:'task',session:session.exportSnapshot(),messages:[],systemPrompt:'',toolDefinitions:[],hostProviderInvocationId:'request',toolInvocationId:'old'};
  const pending=original.executeTool('write',{file_path:file,content:'stale'},context);const rejected=expect(pending).rejects.toThrow();await asked;
  await coordinator!.drainCurrentTurn();await rejected;
  expect(product.getStatus().revoked).toBe(false);
  await expect(original.executeTool('write',{file_path:file,content:'during drain'},context)).rejects.toThrow();
  const replacement=base.forkForCompoundObservation([],['write']);
  await coordinator!.rebindRegistry(replacement);await rejected;expect(readFileSync(file,'utf8')).toBe('before');
  original.dispose();
  expect(await replacement.executeTool('write',{file_path:file,content:'current'},{...context,toolInvocationId:'new'})).not.toContain('Error:');
  expect(readFileSync(file,'utf8')).toBe('current');expect((await store.load(session.exportSnapshot().sessionId))!.compoundOperations!.directOperations).toHaveLength(2);
  expect((await store.load(session.exportSnapshot().sessionId))!.compoundOperations!.treeBudget!.allocations).toHaveLength(2);
  expect((await store.load(session.exportSnapshot().sessionId))!.compoundOperations!.directOperations![0]).toMatchObject({stage:'settled',outcome:'cancelled',finalInputHash:null,quiescence:null});
  await expect(original.executeTool('write',{file_path:file,content:'stale again'},context)).rejects.toThrow();replacement.dispose();
 }finally{await coordinator?.dispose();original.dispose();base.dispose();product.dispose();}
},30000);

it.skipIf(!qualified).each([false,true])('real product rejects stale live history after another durable writer commits during approval (local metadata receipt=%s)',async(localReceipt)=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'product-compound-rebind-')));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const file=join(root,'file'),policyFile=join(root,'policy.json');writeFileSync(file,'before');
 writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt:Date.now()+60000,readFileScopes:[{filePath:file,startLine:1}],bashSources:[],compoundExecution:{version:1,mode:'mechanism-experiment'}}));
 const storeRoot=join(root,'sessions'),store=new FileSessionStore(storeRoot),session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:randomUUID(),cwd:root});const permission=new PermissionManager({mode:'default'});
 const product=await createProductObservationOwner({policy:parseObservationPolicyFile(policyFile),session,profileRoot:join(root,'profile'),environmentRoot,credentialSecrets:[],persist:s=>store.save(s),permissionManager:permission,executionPersistence:{store,root:storeRoot}});
 let entered!:()=>void, approve!:(value:boolean)=>void;const asked=new Promise<void>(r=>entered=r);
 const base=new ToolRegistry({permissionManager:permission,onPrompt:async()=>{entered();return new Promise<boolean>(r=>approve=r);}},buildToolList(undefined,{cwd:root}).filter(t=>t.definition.name==='write'));
 const original=base.forkForCompoundObservation([],['write']);
 const coordinator=await installProductCompoundCoordinator({product,session,store,root:storeRoot,registry:original});
 try{
  const context={taskId:'task',session:session.exportSnapshot(),messages:[],systemPrompt:'',toolDefinitions:[],hostProviderInvocationId:'request',toolInvocationId:'old'};
  const pending=original.executeTool('write',{file_path:file,content:'stale'},context).catch(error=>String(error));await asked;
  const other=new FileSessionStore(storeRoot),identity=session.exportSnapshot().sessionId;
  const lease=await product.executionAuthority!.acquire({invocationId:'other-writer',kind:'recovery'});
  let changed;
  try {
   const previous=(await other.load(identity))!;
   changed={...previous,messages:[...previous.messages,{role:'user' as const,content:[{type:'text' as const,text:'concurrent durable user intent'}]}]};
   await other.compareAndSave({expectedStoreRevision:previous.storeRevision!,expectedHistoryDigest:previous.historyDigest!,nextSnapshot:changed,lease});
   if(localReceipt){const latest=(await store.load(identity))!;await store.compareAndSave({expectedStoreRevision:latest.storeRevision!,expectedHistoryDigest:latest.historyDigest!,nextSnapshot:{...latest,updatedAt:latest.updatedAt+1},lease});}
  }finally{await lease.releaseAfterDrain();}
  approve(true);
  const result=await pending.catch(error=>String(error));
  expect(readFileSync(file,'utf8')).toBe('before');
  expect((await other.load(identity))!.messages).toEqual(changed!.messages);
  expect(result).toContain('compound_live_history_stale');
  expect((await other.load(identity))!.compoundOperations!.directOperations![0]).toMatchObject({stage:'settled',outcome:'invalid',finalInputHash:null,quiescence:null});
 }finally{await coordinator?.dispose();original.dispose();base.dispose();product.dispose();}
},30000);
