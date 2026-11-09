import { describe, expect, it, vi } from 'vitest';
import { createAssistantDesktopSnapshotReader, type AssistantDesktopSnapshotPorts } from '../../electron/assistant-desktop-snapshot.js';
import { readAssistantKSwarmProjects } from '../../electron/assistant-source-ports.js';
import { LoopStore } from '../../electron/loop-store.js';
import type { AssistantLoopProfile } from '../../electron/assistant-loop-executor.js';
const now = Date.parse('2026-10-28T12:00:00Z');
const profile: AssistantLoopProfile = { id:'default-personal-assistant',status:'active',locale:'en',timeZone:'UTC',eveningTime:'22:30',morningTime:'08:30',workdays:[1,2,3,4,5],quietHours:{start:'23:00',end:'07:00'},dataScopes:['tasks','projects','automations','meetings','artifacts'],createdAt:1,updatedAt:1 };
const complete = <T>(items: readonly T[] = []) => ({items,availability:'available' as const,completeness:'complete' as const});
function ports(extra: Partial<AssistantDesktopSnapshotPorts> = {}): AssistantDesktopSnapshotPorts {
 return {listTaskSnapshots:()=>complete(),listKSwarmProjects:()=>complete(),listTimedActions:()=>complete(),listMeetingMetadata:()=>complete(),listKnowledgeSourceMetadata:()=>complete(),...extra};
}
async function collect(deps = ports(), scopes = profile.dataScopes, limits = {}) {
 return createAssistantDesktopSnapshotReader(deps,{limits}).collect({kind:'morning',profile:{...profile,dataScopes:scopes},now});
}
describe('assistant source coverage', () => {
 it('requires structured completeness even for empty results', async () => {
  const snapshot = await collect();
  expect(snapshot.coverage).toHaveLength(5);
  expect(snapshot.coverage.every(c=>c.status==='checked' && c.recordCount===0)).toBe(true);
  expect((await collect(ports({listTaskSnapshots:()=>[]}))).coverage[0].status).toBe('not_checked');
 });
 it('separates unavailable, partial, disabled without raw errors', async () => {
  const snapshot = await collect(ports({listTaskSnapshots:()=>({items:[],availability:'available',completeness:'partial'}),listKSwarmProjects:()=>{throw Error('secret-url');}}),['tasks','projects']);
  expect(snapshot.coverage.map(c=>c.status)).toEqual(['partial','unavailable','disabled','disabled','disabled']);
  expect(JSON.stringify(snapshot.coverage)).not.toContain('secret-url');
 });
 it('accounts for bounded omissions', async () => {
  const items = [1,2].map(id=>({id:String(id),updatedAt:now,title:'task',status:'running'}));
  const snapshot = await collect(ports({listTaskSnapshots:()=>complete(items)}),['tasks'],{maxItemsPerScope:1});
  expect(snapshot.coverage[0]).toMatchObject({status:'partial',recordCount:2,includedCount:1});
 });
 it('does not read disabled sources', async () => {
  const read = vi.fn(()=>complete());
  expect((await collect(ports({listKSwarmProjects:read}),['tasks'])).coverage[1].status).toBe('disabled');
  expect(read).not.toHaveBeenCalled();
 });
 it('distinguishes stopped or malformed KSwarm from checked empty projects', async () => {
  const request = vi.fn();
  expect(await readAssistantKSwarmProjects({getStatus:()=>({running:false,port:null})},request)).toMatchObject({availability:'unavailable'});
  expect(request).not.toHaveBeenCalled();
  expect(await readAssistantKSwarmProjects({getStatus:()=>({running:true,port:1234})},vi.fn().mockResolvedValue({ok:true,json:async()=>({})}))).toMatchObject({availability:'unavailable'});
  expect(await readAssistantKSwarmProjects({getStatus:()=>({running:true,port:1234})},vi.fn().mockResolvedValue({ok:true,json:async()=>({projects:[]})}))).toMatchObject({availability:'available',completeness:'complete',items:[]});
 });
 it('stores enumeration and independent failed analysis through the Loop owner', async () => {
  const store = new LoopStore(':memory:');
  try {
   const snapshot = await collect();
   store.recordAssistantSourceRun({runId:'test-run',profileId:profile.id,kind:'morning',coverage:snapshot.coverage,now});
   store.finishAssistantSourceAnalysis('test-run','failed');
   expect(store.getLatestAssistantSourceRun(profile.id)).toMatchObject({runId:'test-run',analysisStatus:'failed',coverage:snapshot.coverage});
   expect(()=>store.finishAssistantSourceAnalysis('test-run','complete')).toThrow();
  } finally {store.close();}
 });
});

it('coverage survives a database close/reopen and schema migration is repeatable', async () => {
 const {mkdtempSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'assistant-source-restart-'));
 let store:LoopStore|undefined;
 try {
  const path=join(dir,'loop.sqlite');store=new LoopStore(path);
  const snapshot=await collect();
  store.recordAssistantSourceRun({runId:'restart-run',profileId:profile.id,kind:'morning',coverage:snapshot.coverage,now});
  store.close();store=new LoopStore(path);
  expect(store.getLatestAssistantSourceRun(profile.id)).toMatchObject({runId:'restart-run',analysisStatus:'pending'});
  store.finishAssistantSourceAnalysis('restart-run','failed');
  store.close();store=new LoopStore(path);
  expect(store.getLatestAssistantSourceRun(profile.id)?.analysisStatus).toBe('failed');
 } finally {store?.close();rmSync(dir,{recursive:true,force:true});}
});

it('does not trust malformed receipt availability',async()=>{
 const snapshot=await collect(ports({listTaskSnapshots:()=>({items:[],availability:'bogus',completeness:'complete'} as never)}));
 expect(snapshot.coverage[0].status).toBe('unavailable');
});
it('task source reports truncation and recovery failures even when no snapshots survive',async()=>{
 const {readAssistantTaskSource}=await import('../../electron/assistant-task-source.js');
 const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const root=mkdtempSync(join(tmpdir(),'assistant-task-source-'));
 try {
  expect(readAssistantTaskSource(root)).toMatchObject({items:[],availability:'available',completeness:'complete'});
  mkdirSync(join(root,'tasks','snapshots'),{recursive:true});
  for(let i=0;i<3;i++)writeFileSync(join(root,'tasks','snapshots',`${i}.json`),'invalid json');
  expect(readAssistantTaskSource(root,2)).toMatchObject({items:[],availability:'available',completeness:'partial'});
 } finally {rmSync(root,{recursive:true,force:true});}
});
it('supports a main-owned frozen evaluation window without changing daily snapshot defaults',async()=>{
 const {createAssistantDesktopSnapshotReader}=await import('../../electron/assistant-desktop-snapshot.js');let query:unknown;
 const reader=createAssistantDesktopSnapshotReader({listTaskSnapshots:q=>{query=q;return {items:[],availability:'available',completeness:'complete'};},listKSwarmProjects:()=>[],listTimedActions:()=>[],listMeetingMetadata:()=>[],listKnowledgeSourceMetadata:()=>[]});
 const profile={id:'default-personal-assistant',timeZone:'UTC',dataScopes:['tasks']};
 const snap=await reader.collect({kind:'morning',profile:profile as any,now:10000000,window:{from:1,to:9000000}} as any);expect(query).toEqual({from:1,to:9000000});expect(snap.from).toBe(1);
 await expect(reader.collect({kind:'morning',profile:profile as any,now:10000000,window:{from:100,to:1}} as any)).rejects.toThrow('window');
});
