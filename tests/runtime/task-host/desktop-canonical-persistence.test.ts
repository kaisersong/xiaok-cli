import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync,realpathSync,existsSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {DesktopTaskObservationStore,desktopObservationSessionId} from '../../../src/runtime/task-host/protected-observation-store.js';
import {resolveCompoundHostStorage,inspectCompoundHostSources} from '../../../src/runtime/sol-pi/compound-host-storage.js';
import {createObservationService} from '../../../src/runtime/sol-pi/observation-service.js';
import {createObservationSessionOwner} from '../../../src/runtime/sol-pi/observation-session-owner.js';
import {openCompoundExecutionDomain} from '../../../src/runtime/sol-pi/compound-execution-domain.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
it('routes actual main persistence through canonical CAS and keeps the task sidecar a read-only alias even before any observation',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'desktop-canonical-'))),tasks=join(root,'desktop','tasks');
 const layout=resolveCompoundHostStorage({configRoot:root}),observations=new DesktopTaskObservationStore(tasks),taskId='task-one';
 const original=observations.getExecutionPersistence(taskId,()=>{}),port=original.routeCanonical!(layout);
 const sessionId=desktopObservationSessionId(taskId),session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId,cwd:root});
 const service=createObservationService({profileRoot:join(root,'profile'),profileId:'p',reservedProfileBytes:2*1024*1024,redactor:{version:'unused',redact(){throw Error('unused');}}});
 const caller=service.bindCaller({sessionId,ownerAgentId:'owner',scopeId:'scope',permissionGeneration:1,surface:'ordinary-owner',requestSource:'agent'});
 const owner=createObservationSessionOwner({service,caller,session,destination:{provider:'test',model:'test',url:'https://example.test'},persist:value=>port.store.save(value)});
 const authority=createSessionExecutionAuthority({root:layout.canonicalRoot,sessionIdentity:sessionId,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'owner',scopeId:'scope'})});
 const lease=await authority.acquire({invocationId:'initialize',kind:'recovery'});
 try{
  const domain=openCompoundExecutionDomain({owner,storeRoot:layout.canonicalRoot,lease,inventory:inspectCompoundHostSources(layout)});
  await port.initialize(session.exportSnapshot(),lease);await port.registerAlias!(domain,lease);
  expect(()=>port.getCompoundTreeStore!({...domain})).toThrow('compound_domain_invalid');
  const treeStore=port.getCompoundTreeStore!(domain);let commits=0;
  const unsubscribe=port.store.onCommit!(()=>{commits++;});
  const prior=(await treeStore.load(sessionId))!;
  await treeStore.compareAndSave!({expectedStoreRevision:prior.storeRevision!,expectedHistoryDigest:prior.historyDigest!,nextSnapshot:{...prior,updatedAt:prior.updatedAt+1},lease});
  unsubscribe();expect(commits).toBe(1);
  await expect(port.store.load('foreign-session')).rejects.toThrow('SOL_PI_DESKTOP_SESSION_MISMATCH');
  await expect(port.registerManagedAlias!({} as never,domain,lease)).rejects.toThrow('compound_managed_admission_invalid');
  expect(port.root).toBe(layout.canonicalRoot);expect((await port.store.load(sessionId))?.executionProtected).toBe(true);
  expect(await observations.readProtection(taskId)).toEqual({closure:undefined,executionProtected:true});
  expect(await observations.readProtectionInWorker(taskId)).toEqual({closure:undefined,executionProtected:true});
  expect(observations.readProtectionSync(taskId)).toEqual({closure:undefined,executionProtected:true});
  expect(existsSync(join(tasks,'protected-observation-sessions',sessionId+'.json'))).toBe(false);
  await expect(original.store.save(session.exportSnapshot())).rejects.toThrow(/alias/);
  await expect(observations.persistSession(taskId,session.exportSnapshot())).rejects.toThrow(/alias/);
  const durable=(await port.store.load(sessionId))!;
  expect(observations.publishCanonicalFacts(taskId,durable)).toBe(true);
  expect(()=>observations.publishCanonicalFacts(taskId,{...durable,messages:[{role:'user',content:[{type:'text',text:'stale overwrite'}]}] as any})).toThrow(/publication_mismatch/);
  await expect(port.registerAlias!({...domain},lease)).rejects.toThrow(/domain_invalid/);
  const current=(await port.store.load(sessionId))!;
  const closure={version:1 as const,requiresReauthorization:true as const,observations:[]};
  await port.store.compareAndSave!({nextSnapshot:{...current,protectedObservationClosure:closure},expectedStoreRevision:current.storeRevision!,expectedHistoryDigest:current.historyDigest!,lease});
  await expect(observations.save(taskId,closure)).resolves.toBeUndefined();
  expect(await observations.readProtectionInWorker(taskId)).toEqual({closure,executionProtected:true});
  await expect(observations.save(taskId,{...closure,observations:[{authorityId:'00000000-0000-4000-8000-000000000000',profileId:'p',sourceSessionId:sessionId,ownerAgentId:'owner',scopeId:'scope',permissionGeneration:1,observationId:'missing',contentHash:'a'.repeat(64),revision:1,policyId:'policy',policyRevision:1}]})).rejects.toThrow(/alias/);
  domain.close(lease);
 }finally{owner.dispose();await lease.releaseAfterDrain();authority.dispose();service.dispose();rmSync(root,{recursive:true,force:true});}
});
it('actual TaskHost publishes canonical facts into its task journal without writing an alias history',async()=>{
 const {FileTaskSnapshotStore}=await import('../../../src/runtime/task-host/snapshot-store.js');
 const {InProcessTaskRuntimeHost}=await import('../../../src/runtime/task-host/task-runtime-host.js');
 const {MaterialRegistry}=await import('../../../src/runtime/task-host/material-registry.js');
 const root=realpathSync(mkdtempSync(join(tmpdir(),'desktop-canonical-host-'))),tasks=join(root,'desktop','tasks');mkdirSync(tasks,{recursive:true});
 const snapshots=new FileTaskSnapshotStore(tasks),layout=resolveCompoundHostStorage({configRoot:root});let published=false;let failure:unknown;
 const host=new InProcessTaskRuntimeHost({snapshotStore:snapshots,materialRegistry:new MaterialRegistry({workspaceRoot:join(root,'workspace'),maxBytes:1024}),runner:async input=>{
  const port=input.executionPersistence!.routeCanonical!(layout),session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:desktopObservationSessionId(input.taskId),cwd:root});
  const service=createObservationService({profileRoot:join(root,'profile'),profileId:'p',reservedProfileBytes:2*1024*1024,redactor:{version:'unused',redact(){throw Error('unused');}}});
  const caller=service.bindCaller({sessionId:session.exportSnapshot().sessionId,ownerAgentId:'owner',scopeId:'scope',permissionGeneration:1,surface:'ordinary-owner',requestSource:'agent'});
  const owner=createObservationSessionOwner({service,caller,session,destination:{provider:'test',model:'test',url:'https://example.test'},persist:value=>port.store.save(value)});
  const authority=createSessionExecutionAuthority({root:port.root,sessionIdentity:session.exportSnapshot().sessionId,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'owner',scopeId:'scope'})});
  const lease=await authority.acquire({invocationId:'initialize',kind:'recovery'});let domain:ReturnType<typeof openCompoundExecutionDomain>|undefined;
  try{domain=openCompoundExecutionDomain({owner,storeRoot:port.root,lease,inventory:inspectCompoundHostSources(layout)});await port.initialize(session.exportSnapshot(),lease);await port.registerAlias!(domain,lease);
   const durable=(await port.store.load(session.exportSnapshot().sessionId))!;await input.persistObservationSnapshot!(durable);published=true;
  }catch(error){failure=error;throw error;}finally{domain?.close(lease);owner.dispose();await lease.releaseAfterDrain();authority.dispose();service.dispose();}
 }});
 try{const {taskId}=await host.createTask({prompt:'bounded answer',materials:[]});await host.drain();expect(failure).toBeUndefined();expect(published).toBe(true);expect((await snapshots.recoverTask(taskId))?.executionProtected).toBe(true);
  expect(existsSync(join(tasks,'protected-observation-sessions',desktopObservationSessionId(taskId)+'.json'))).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('keeps ordinary non-alias task identifiers compatible',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'desktop-ordinary-id-')));
 try{const store=new DesktopTaskObservationStore(root);expect(await store.readProtection('普通任务.v1')).toEqual({closure:undefined});expect(store.readProtectionSync('普通任务.v1')).toEqual({});}finally{rmSync(root,{recursive:true,force:true});}
});
