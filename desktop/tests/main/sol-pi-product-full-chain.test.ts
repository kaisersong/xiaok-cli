// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { createDesktopObservationApprovals } from '../../electron/desktop-observation-approval.js';
import { parseObservationPolicyFile, describeProductObservationPolicy } from '../../../src/runtime/sol-pi/product-bootstrap.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { desktopObservationSessionId } from '../../../src/runtime/task-host/protected-observation-store.js';

const ready = process.platform === 'darwin' && process.arch === 'arm64' && existsSync(join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1/environment.json'));
describe('Desktop product full main chain with official offline counter',()=>{
 it.skipIf(!ready)('persists task closure before wire and prompts exact native command before two full views then reference',async()=>{
  const root=realpathSync(mkdtempSync(join(process.cwd(),'.solpi-desktop-product-'))), priorConfig=process.env.XIAOK_CONFIG_DIR, priorFetch=globalThis.fetch;
  const configRoot=join(root,'config'),dataRoot=join(root,'data'),workspace=join(root,'workspace');
  for(const dir of [configRoot,dataRoot,workspace])mkdirSync(dir);
  process.env.XIAOK_CONFIG_DIR=configRoot;
  const file=join(workspace,'material.txt'),marker='DESKTOP_MAIN_ARCHIVED_MIDDLE',body='head '.repeat(1500)+marker+'tail '.repeat(1500);
  writeFileSync(file,body);
  const unapproved=join(workspace,'unapproved.txt');writeFileSync(unapproved,'UNAPPROVED_ARCHIVE_BODY'.repeat(500));
  writeFileSync(join(configRoot,'config.json'),JSON.stringify({schemaVersion:2,defaultProvider:'deepseek',defaultModelId:'current',providers:{deepseek:{type:'first_party',protocol:'openai_legacy',baseUrl:'https://api.deepseek.com',apiKey:'fixture-private'}},models:{current:{provider:'deepseek',model:'old-alias',label:'Current'}},defaultMode:'interactive'}));
  const command='printf DESKTOP_APPROVED_ONCE';
  const policyFile=join(root,'policy.json');writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt:Date.now()+240000,readFileScopes:[{filePath:file,startLine:1}],bashSources:[{command,cwd:workspace}]}));
  const policy=parseObservationPolicyFile(policyFile), confirmations:string[]=[],prompts:any[]=[],bodies:string[]=[];
  const approvals=createDesktopObservationApprovals({selectPolicy:async()=>({policy,summary:describeProductObservationPolicy(policy)}),confirm:async(_sender,_summary,kind)=>{confirmations.push(kind);return true;}});
  const sender={},draft=await approvals.prepare(sender);expect(draft).not.toBeNull();
  const approval=approvals.consume(sender,draft!.draftId);
  let services:ReturnType<typeof createDesktopServices>|undefined,taskId:string|undefined;
  let approve!:()=>void;const permissionGate=new Promise<void>(resolve=>{approve=resolve;});
  let barrierChecks=0;
  globalThis.fetch=async(_url,init)=>{
   const serialized=String(init?.body);bodies.push(serialized);const n=bodies.length;
   if(serialized.includes(marker)) {
    const dir=join(dataRoot,'tasks','protected-observation-sessions');
    const snapshot=JSON.parse(readFileSync(join(dir,readdirSync(dir).find(name=>name.endsWith('.json')&&name!=='latest.json')!),'utf8'));
    expect(snapshot.protectedObservationClosure).toBeTruthy();
    const recovered=await services!.recoverTask(taskId!);expect(recovered.snapshot.protectedObservationClosure).toBeTruthy();barrierChecks++;
   }
   const invocation=n===1?{name:'read',arguments:JSON.stringify({file_path:file,max_chars:80})}:n===2?{name:'bash',arguments:JSON.stringify({command,workdir:workspace})}:n===3?{name:'read',arguments:JSON.stringify({file_path:unapproved,max_chars:80})}:undefined;
   const delta=invocation?{tool_calls:[{index:0,id:'native-'+n,type:'function',function:invocation}]}:{content:'DESKTOP_PRODUCT_DONE'};
   return new Response('data: '+JSON.stringify({choices:[{delta,finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:invocation?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  };
  try {
   services=createDesktopServices({dataRoot,workspaceRoot:workspace,pluginRootDir:join(root,'empty-plugins'),kswarmService:{start:async()=>{},stop:async()=>{},restart:async()=>{},getStatus:()=>({running:true,port:4400,pid:1,restartCount:0,lastError:null}),onStatusChange:()=>()=>{},getDesktopMutationToken:()=> 'fixture',request:async()=>new Response('{}',{status:501})} as any});
   const created=await services.createObservationTask({prompt:'Read the material, run the exact verification command, read the second file once and finish.',materials:[],permissionMode:'default'},{requestSource:'user',approval,onPrompt:async(tool,input)=>{prompts.push({tool,input:structuredClone(input)});await permissionGate;return true;}});taskId=created.taskId;
   const deadline=Date.now()+90000;
   while(!prompts.length&&Date.now()<deadline){const state=await services.recoverTask(taskId);if(['completed','failed','cancelled'].includes(state.snapshot.status))throw new Error(JSON.stringify(state));await new Promise(r=>setTimeout(r,25));}
   expect(prompts).toHaveLength(1);expect(prompts[0]).toMatchObject({tool:'bash',input:{command,workdir:workspace}});expect(bodies).toHaveLength(2);approve();
   let recovered:any;
   do{recovered=await services.recoverTask(taskId);if(['completed','failed','cancelled'].includes(recovered.snapshot.status))break;await new Promise(r=>setTimeout(r,25));}while(Date.now()<deadline);
   expect(recovered.snapshot.status,JSON.stringify(recovered)).toBe('completed');
   expect(bodies).toHaveLength(4);expect(bodies[1]).toContain(marker);expect(bodies[2]).toContain(marker);expect(bodies[3]).not.toContain(marker);expect(barrierChecks).toBe(2);
   expect(confirmations).toEqual(['persistence','disclosure']);expect(prompts).toHaveLength(1);
   const sidecar=JSON.parse(readFileSync(join(dataRoot,'tasks','protected-observation-sessions',desktopObservationSessionId(taskId)+'.json'),'utf8'));
   expect(sidecar.protectedObservationClosure).toEqual(recovered.snapshot.protectedObservationClosure);
   const restartedStore=new FileTaskSnapshotStore(join(dataRoot,'tasks'));
   expect((await restartedStore.recoverTask(taskId))?.protectedObservationClosure).toEqual(sidecar.protectedObservationClosure);
   await expect(services.createTask({prompt:'Continue the previous protected task.',materials:[],context:{taskIds:[taskId]}})).rejects.toThrow(/PROTECTED_HISTORY/);
   expect(bodies).toHaveLength(4);
   expect(JSON.stringify(sidecar)).not.toContain(marker);
   expect(JSON.parse(readFileSync(join(configRoot,'config.json'),'utf8')).models.current.model).toBe('old-alias');
   const counterRoot=join(configRoot,'observation-profile','counters');expect(readdirSync(counterRoot)).toHaveLength(1);
   const ledger=JSON.parse(readFileSync(join(counterRoot,readdirSync(counterRoot)[0],'full-send.json'),'utf8'));
   expect(ledger.sessionId).toBe(desktopObservationSessionId(taskId));expect(ledger.clean).toBe(true);expect(Object.values(ledger.observations)).toEqual([2,2]);
   const archiveRoot=join(configRoot,'observation-profile','observations');
   const archiveFiles=readdirSync(archiveRoot,{recursive:true}).filter(name=>String(name).endsWith('.body'));expect(archiveFiles).toHaveLength(2);
   for(const name of archiveFiles)expect(readFileSync(join(archiveRoot,String(name)),'utf8')).not.toContain('UNAPPROVED_ARCHIVE_BODY');
   const boundary=services.multiAgent!;await boundary.ready;
   const threadId=recovered.snapshot.context.threadId;expect(typeof threadId).toBe('string');
   const access=boundary.service.createUserAccess({requestSource:'user',actorId:`desktop-user:${boundary.profileId}`,profileId:boundary.profileId,workspaceId:boundary.workspaceId,threadId});
   const deletion=boundary.service.readThreadDeletion({access});
   const deleted=await boundary.service.deleteThread({access,requestSource:'user',operationId:`delete:${deletion.threadRevision}:observation_test`,expectedThreadRevision:deletion.threadRevision,confirmTerminate:true});
   expect(deleted.state).toBe('completed');
   const indexes=archiveFiles.map(name=>join(archiveRoot,String(name).replace(/\.body$/,'.json')));
   const unpinned=()=>indexes.every(file=>JSON.parse(readFileSync(file,'utf8')).pins.length===0);
   while(!unpinned()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
   expect(unpinned()).toBe(true);expect(bodies).toHaveLength(4);
   for(const file of indexes)expect(JSON.parse(readFileSync(file,'utf8')).referenceReconciliation.actorKind).toBe('system_reconcile');

  } finally {approve();if(services&&taskId)await services.cancelTask(taskId).catch(()=>{});await services?.disposeMultiAgent();globalThis.fetch=priorFetch;if(priorConfig===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=priorConfig;rmSync(root,{recursive:true,force:true});}
 },120000);
});
