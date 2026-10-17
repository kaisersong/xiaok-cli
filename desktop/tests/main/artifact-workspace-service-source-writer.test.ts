// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ArtifactWorkspaceStore} from '../../electron/artifact-workspace-store.js';
import {ArtifactWorkspaceFileManager} from '../../electron/artifact-workspace-files.js';
import {ArtifactWorkspaceService} from '../../electron/artifact-workspace-service.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import {InProcessTaskRuntimeHost} from '../../../src/runtime/task-host/task-runtime-host.js';
const cleanup:Array<()=>Promise<void>>=[];afterEach(async()=>{vi.useRealTimers();vi.restoreAllMocks();for(const close of cleanup.splice(0))await close();});
async function fixture(){
 const root=mkdtempSync(join(tmpdir(),'artifact-service-close-')),workspace=join(root,'workspace');mkdirSync(workspace);const file=join(workspace,'original.md');writeFileSync(file,'# Original material');
 const snapshotStore=new FileTaskSnapshotStore(join(root,'tasks')),materialRegistry=new MaterialRegistry({workspaceRoot:join(root,'materials'),maxBytes:1024}),store=new ArtifactWorkspaceStore({dbPath:join(root,'artifact.sqlite')}),files=new ArtifactWorkspaceFileManager({managedRoot:join(root,'managed')});let release!:()=>void;const run=new Promise<void>(r=>release=r);
 let sequence=0;const host=new InProcessTaskRuntimeHost({snapshotStore,materialRegistry,runner:async()=>{await run;},createTaskId:()=> 'generation-task-'+(++sequence),createSessionId:()=> 'generation-session-'+sequence});
 const service=new ArtifactWorkspaceService({store,snapshotStore,taskHost:host,fileManager:files,workspaceRoot:workspace,featureFlags:{artifactWorkspaceRevisionUi:true,artifactSpatialWorkspace:true}});
 const identity={conversationId:'conversation',workspaceRootId:workspace},input={...identity,requestSource:'user' as const,sourceTaskId:'source-task',artifactId:'original',expectedStructureRevision:0};
 await snapshotStore.save({taskId:'source-task',sessionId:'source-session',status:'completed',prompt:'source',materials:[],events:[{type:'artifact_recorded',artifactId:'original',kind:'markdown',label:'original',filePath:file,previewAvailable:true,turnId:'turn'}],createdAt:1,updatedAt:1});
 cleanup.push(async()=>{release();await host.closeSourceWriterForMigration();store.close();rmSync(root,{recursive:true,force:true});});return {root,workspace,snapshotStore,store,files,host,service,identity,input,release};
}
function gate(){let entered!:()=>void,release!:()=>void;return {started:new Promise<void>(r=>entered=r),wait:new Promise<void>(r=>release=r),entered:()=>entered(),release:()=>release()};}
it('waits for an actual admitted materialization and rejects every late write before touching dependencies',async()=>{
 const f=await fixture(),block=gate(),recover=f.snapshotStore.recoverTask.bind(f.snapshotStore);vi.spyOn(f.snapshotStore,'recoverTask').mockImplementation(async id=>{block.entered();await block.wait;return recover(id);});
 const pending=f.service.materializeArtifact(f.input);await block.started;const close=f.service.sealAndDrainInstanceMutations();expect(f.service.sealAndDrainInstanceMutations()).toBe(close);let ended=false;void close.then(()=>ended=true);await Promise.resolve();expect(ended).toBe(false);
 await expect(f.service.materializeArtifact(f.input)).rejects.toThrow('artifact_service_source_closed');await expect(f.service.exportArtifactWorkspaceVersion({...f.identity,versionId:'missing',destinationPath:join(f.root,'late','out.md')})).rejects.toThrow('artifact_service_source_closed');await expect(f.service.getArtifactWorkspaceSnapshot({...f.identity,viewKey:'late'})).rejects.toThrow('artifact_service_source_closed');expect(()=>f.service.cleanup()).toThrow('artifact_service_source_closed');expect(()=>f.service.recordPublicMutationFailure(f.identity,'late',Error('late'))).toThrow('artifact_service_source_closed');expect(existsSync(join(f.root,'late'))).toBe(false);
 block.release();const result=await pending;await close;expect(readFileSync(f.files.resolveManagedRef(result.version.fileRef),'utf8')).toBe('# Original material');expect(f.store.listVersions(result.lineage.id)).toHaveLength(1);
});
it('admits a synchronous callback before reentrant seal and refuses listener reentry',async()=>{
 const f=await fixture();let close:Promise<void>|undefined,late:Promise<unknown>|undefined;f.service.subscribeChanges(()=>{close=f.service.sealAndDrainInstanceMutations();late=f.service.createArtifactWorkspaceNote({...f.identity,requestSource:'user',expectedStructureRevision:0,noteText:'late'});void late.catch(()=>{});});f.service.notifyIdentityChanged(f.identity);await close;await expect(late).rejects.toThrow('artifact_service_source_closed');expect(f.store.listWorkspaces()).toHaveLength(1);expect(()=>f.service.sealAndDrainInstanceMutations.call({...f.service})).toThrow('artifact_service_source_owner');
});
it('retains an original timed-out snapshot recovery until it actually finishes',async()=>{
 const f=await fixture(),placeholder=await f.service.createArtifactPlaceholder({...f.identity,requestSource:'user',expectedStructureRevision:0,requestedKind:'markdown'});await f.service.submitArtifactGeneration({...f.identity,requestSource:'user',placeholderNodeId:placeholder.id,prompt:'generate'});
 const block=gate(),recover=f.snapshotStore.recoverTask.bind(f.snapshotStore);vi.spyOn(f.snapshotStore,'recoverTask').mockImplementation(async id=>{block.entered();await block.wait;return recover(id);});vi.useFakeTimers();const reconcile=f.service.reconcileStartup();await block.started;await vi.advanceTimersByTimeAsync(30_001);await reconcile;const close=f.service.sealAndDrainInstanceMutations();let ended=false;void close.then(()=>ended=true);await Promise.resolve();await Promise.resolve();expect(ended).toBe(false);block.release();await close;vi.useRealTimers();f.release();
});

it('blocks all 27 original public business entrances immediately after seal',async()=>{
 const f=await fixture();await f.service.sealAndDrainInstanceMutations();const names=['notifyIdentityChanged','getArtifactWorkspaceSnapshot','closeArtifactWorkspace','closeArtifactWorkspaceViewKey','recordEligibleArtifactOpened','materializeArtifact','createArtifactPlaceholder','createArtifactWorkspaceCollection','createArtifactWorkspaceNote','updateArtifactWorkspaceNote','createArtifactWorkspaceRelation','setArtifactCollectionMembership','removeArtifactWorkspaceNode','updateArtifactWorkspaceLayout','saveArtifactWorkspaceViewport','preferArtifactVersion','submitArtifactGeneration','cancelArtifactGeneration','retryArtifactGeneration','claimProducedArtifact','handlePersistedTaskEvent','reconcileStartup','readArtifactWorkspaceVersionPreview','exportArtifactWorkspaceVersion','recordArtifactWorkspaceEvent','cleanup','recordPublicMutationFailure'];
 const input=new Proxy({},{get(){throw Error('late input was read');}});for(const name of names){const method=Reflect.get(f.service,name) as (...args:unknown[])=>unknown;await expect(Promise.resolve().then(()=>Reflect.apply(method,f.service,[input]))).rejects.toThrow('artifact_service_source_closed');}expect(f.store.listWorkspaces()).toHaveLength(0);
});
it('lets an admitted retry finish its original private submit tail after reentrant seal',async()=>{
 const f=await fixture(),placeholder=await f.service.createArtifactPlaceholder({...f.identity,requestSource:'user',expectedStructureRevision:0,requestedKind:'markdown'}),old=await f.service.submitArtifactGeneration({...f.identity,requestSource:'user',placeholderNodeId:placeholder.id,prompt:'generate'});f.store.updateGenerationState(old.id,'failed','runtime_unavailable');const original=f.store.beginGenerationRetry.bind(f.store);let close:Promise<void>|undefined;
 vi.spyOn(f.store,'beginGenerationRetry').mockImplementation(input=>{const result=original(input);close=f.service.sealAndDrainInstanceMutations();return result;});const retried=await f.service.retryArtifactGeneration({...f.identity,requestSource:'user',generationRequestId:old.id,prompt:'retry'});await close;expect(retried.state).toBe('running');expect(retried.supersedesRequestId).toBe(old.id);await expect(f.service.submitArtifactGeneration({...f.identity,requestSource:'user',placeholderNodeId:placeholder.id,prompt:'late'})).rejects.toThrow('artifact_service_source_closed');
});
it('waits for and retains the failure of an admitted original operation',async()=>{
 const f=await fixture(),block=gate();vi.spyOn(f.snapshotStore,'recoverTask').mockImplementation(async()=>{block.entered();await block.wait;throw Error('actual recovery boundary failed');});const work=f.service.materializeArtifact(f.input),failure=expect(work).rejects.toThrow('actual recovery boundary failed');await block.started;const close=f.service.sealAndDrainInstanceMutations(),closing=expect(close).rejects.toThrow('artifact_service_close_unconfirmed');block.release();await failure;await closing;expect(f.service.sealAndDrainInstanceMutations()).toBe(close);
});
