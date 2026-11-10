// @vitest-environment node
import {afterAll,afterEach,beforeEach,expect,it,vi} from 'vitest';
import{existsSync,mkdtempSync,mkdirSync,realpathSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
const state=vi.hoisted(()=>{const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'loop-source-account-'))),home=path.join(root,'account'),config=path.join(home,'config');fs.mkdirSync(config,{recursive:true,mode:0o700});const prior=process.env.XIAOK_CONFIG_DIR;process.env.XIAOK_CONFIG_DIR=config;return{home,root,config,prior};});
vi.unmock('../../electron/loop-database-source-observation.js');
vi.mock('node:os',async load=>{const actual=await load<typeof import('node:os')>();return{...actual,userInfo:()=>({...actual.userInfo(),homedir:state.home}),homedir:()=>state.home};});
vi.unmock('../../../src/runtime/verification/migration-markers.js');
import{readOrdinaryProfileSources}from'../../../src/runtime/verification/ordinary-profile-source-registry.js';
import{createLoopDatabaseOwnerGroup,openLoopDatabase}from'../../electron/loop-database-owner.js';
import{LoopStore}from'../../electron/loop-store.js';import{CompletionEvidenceStore}from'../../electron/completion-evidence-store.js';
import{registerLoopDatabaseSourceObservation}from'../../electron/loop-database-source-observation.js';
let root:string;const cleanup:Array<()=>void>=[];beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'loop-source-observation-')));});afterEach(()=>{for(const close of cleanup.splice(0).reverse())close();rmSync(root,{recursive:true,force:true});});
it('retains actual successful constructor observations when the next owner opens only a subset',()=>{
 const path=join(root,'shared.sqlite'),first=createLoopDatabaseOwnerGroup([path]);cleanup.push(()=>first.close());new LoopStore(first.sources[0]);if(process.platform==='win32'){
 expect(()=>registerLoopDatabaseSourceObservation(first.sources[0])).toThrow('profile_source_registry_account');
 expect(()=>readOrdinaryProfileSources()).toThrow('profile_source_registry_account');
 expect(existsSync(join(state.config,'profile-sources','registry.json'))).toBe(false);
 const lease=openLoopDatabase(first.sources[0]);expect(lease.database.prepare("SELECT name FROM sqlite_master WHERE name='loop_definitions'").get()).toBeDefined();lease.close();return;
 }registerLoopDatabaseSourceObservation(first.sources[0]);new CompletionEvidenceStore(first.sources[0]);registerLoopDatabaseSourceObservation(first.sources[0]);first.close();
 const next=createLoopDatabaseOwnerGroup([path]);cleanup.push(()=>next.close());new LoopStore(next.sources[0]);registerLoopDatabaseSourceObservation(next.sources[0]);const row=readOrdinaryProfileSources()!.sources[0];expect(row.componentHistory?.components).toEqual(['completion','loop']);expect(row.componentHistory?.historyUnknown).toBe(true);expect(row.componentHistory?.observations).toHaveLength(2);
 expect(()=>registerLoopDatabaseSourceObservation({...next.sources[0]})).toThrow('loop_database_source');next.close();expect(()=>registerLoopDatabaseSourceObservation(next.sources[0])).toThrow('loop_database_closed');
});
it('never claims complete history when a successful constructor was not durably observed',()=>{
 const path=join(root,'crash-window.sqlite'),first=createLoopDatabaseOwnerGroup([path]);cleanup.push(()=>first.close());new LoopStore(first.sources[0]);if(process.platform==='win32'){
 expect(()=>registerLoopDatabaseSourceObservation(first.sources[0])).toThrow('profile_source_registry_account');
 expect(()=>readOrdinaryProfileSources()).toThrow('profile_source_registry_account');
 expect(existsSync(join(state.config,'profile-sources','registry.json'))).toBe(false);
 const lease=openLoopDatabase(first.sources[0]);expect(lease.database.prepare("SELECT name FROM sqlite_master WHERE name='loop_definitions'").get()).toBeDefined();lease.close();return;
 }registerLoopDatabaseSourceObservation(first.sources[0]);new CompletionEvidenceStore(first.sources[0]);first.close();
 const next=createLoopDatabaseOwnerGroup([path]);cleanup.push(()=>next.close());new LoopStore(next.sources[0]);registerLoopDatabaseSourceObservation(next.sources[0]);const lease=openLoopDatabase(next.sources[0]);expect(lease.database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='completion_expectations'").get()).toBeDefined();lease.close();const facts=readOrdinaryProfileSources()!;expect(facts.legacyInventoryRequired).toBe(true);expect(facts.sources[0].componentHistory).toMatchObject({historyUnknown:true,components:['loop']});expect(facts.sources[0].componentHistory).not.toHaveProperty('historyComplete');
});

afterAll(()=>{if(state.prior===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=state.prior;rmSync(state.root,{recursive:true,force:true});});
