// @vitest-environment node
import {setProfileTestHome} from '../../../tests/support/profile-home-env.js';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import{mkdtempSync,mkdirSync,realpathSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
const state=vi.hoisted(()=>({home:''}));
vi.mock('node:os',async load=>{const actual=await load<typeof import('node:os')>();return{...actual,userInfo:()=>({...actual.userInfo(),homedir:state.home})};});
vi.mock('../../../src/runtime/verification/migration-markers.js',()=>({readInstalledCurrentProfile:()=>({kind:'ordinary'})}));
import{readOrdinaryProfileSources}from'../../../src/runtime/verification/ordinary-profile-source-registry.js';
import{createLoopDatabaseOwnerGroup,openLoopDatabase}from'../../electron/loop-database-owner.js';
import{LoopStore}from'../../electron/loop-store.js';import{CompletionEvidenceStore}from'../../electron/completion-evidence-store.js';
import{registerLoopDatabaseSourceObservation}from'../../electron/loop-database-source-observation.js';
let root:string;const cleanup:Array<()=>void>=[];beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'loop-source-observation-')));state.home=join(root,'account');setProfileTestHome(state.home);mkdirSync(state.home);});afterEach(()=>{for(const close of cleanup.splice(0).reverse())close();rmSync(root,{recursive:true,force:true});});
it('retains actual successful constructor observations when the next owner opens only a subset',()=>{
 const path=join(root,'shared.sqlite'),first=createLoopDatabaseOwnerGroup([path]);cleanup.push(()=>first.close());new LoopStore(first.sources[0]);registerLoopDatabaseSourceObservation(first.sources[0]);new CompletionEvidenceStore(first.sources[0]);registerLoopDatabaseSourceObservation(first.sources[0]);first.close();
 const next=createLoopDatabaseOwnerGroup([path]);cleanup.push(()=>next.close());new LoopStore(next.sources[0]);registerLoopDatabaseSourceObservation(next.sources[0]);const row=readOrdinaryProfileSources()!.sources[0];expect(row.componentHistory?.components).toEqual(['completion','loop']);expect(row.componentHistory?.historyUnknown).toBe(true);expect(row.componentHistory?.observations).toHaveLength(2);
 expect(()=>registerLoopDatabaseSourceObservation({...next.sources[0]})).toThrow('loop_database_source');next.close();expect(()=>registerLoopDatabaseSourceObservation(next.sources[0])).toThrow('loop_database_closed');
});
it('never claims complete history when a successful constructor was not durably observed',()=>{
 const path=join(root,'crash-window.sqlite'),first=createLoopDatabaseOwnerGroup([path]);cleanup.push(()=>first.close());new LoopStore(first.sources[0]);registerLoopDatabaseSourceObservation(first.sources[0]);new CompletionEvidenceStore(first.sources[0]);first.close();
 const next=createLoopDatabaseOwnerGroup([path]);cleanup.push(()=>next.close());new LoopStore(next.sources[0]);registerLoopDatabaseSourceObservation(next.sources[0]);const lease=openLoopDatabase(next.sources[0]);expect(lease.database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='completion_expectations'").get()).toBeDefined();lease.close();const facts=readOrdinaryProfileSources()!;expect(facts.legacyInventoryRequired).toBe(true);expect(facts.sources[0].componentHistory).toMatchObject({historyUnknown:true,components:['loop']});expect(facts.sources[0].componentHistory).not.toHaveProperty('historyComplete');
});
