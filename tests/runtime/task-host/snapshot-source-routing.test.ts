import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const state=vi.hoisted(()=>({home:'',route:'ordinary',read:undefined as (()=>void)|undefined}));
vi.mock('node:os',async load=>{const actual=await load<typeof import('node:os')>();return {...actual,userInfo:()=>({...actual.userInfo(),homedir:state.home})};});
vi.mock('../../../src/runtime/verification/migration-markers.js',async load=>{const actual=await load<typeof import('../../../src/runtime/verification/migration-markers.js')>();return {...actual,readInstalledCurrentProfile:()=>{state.read?.();return {kind:state.route};}};});
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {readOrdinaryProfileSources} from '../../../src/runtime/verification/ordinary-profile-source-registry.js';
import type {TaskSnapshot} from '../../../src/runtime/task-host/types.js';
import {setProfileTestHome} from '../../support/profile-home-env.js';
let work:string,root:string;const stores:FileTaskSnapshotStore[]=[];
const task=(id='task-a'):TaskSnapshot=>({taskId:id,sessionId:'original-session',status:'running',prompt:'Original task',materials:[],events:[],createdAt:1,updatedAt:2});
function store(path=root,diagnostics={}){const result=new FileTaskSnapshotStore(path,diagnostics);stores.push(result);return result;}
beforeEach(()=>{work=realpathSync(mkdtempSync(join(tmpdir(),'task-source-routing-')));state.home=join(work,'account');mkdirSync(state.home);setProfileTestHome(state.home);root=join(work,'tasks');state.route='ordinary';state.read=undefined;});
afterEach(async()=>{state.read=undefined;await Promise.all(stores.splice(0).map(s=>s.closeAndDrain()));rmSync(work,{recursive:true,force:true,maxRetries:3});});
it('records the actual first write root and preserves prior roots with duplicate generations unchanged',async()=>{
 const first=store();await first.save(task());const original=readOrdinaryProfileSources()!;
 expect(original.sources.filter(s=>s.kind==='task-root').map(s=>s.directory.canonicalPath)).toEqual([root]);
 expect(original.legacyInventoryRequired).toBe(true);await first.saveWithReceipt({...task(),updatedAt:3});await first.clearActiveTask('task-a');
 expect(readOrdinaryProfileSources()!.generation).toBe(original.generation);
 const second=join(work,'new-tasks');await store(second).save(task('task-b'));
 expect(readOrdinaryProfileSources()!.sources.filter(s=>s.kind==='task-root').map(s=>s.directory.canonicalPath)).toEqual([root,second]);
});
it.each(['pending','protected','unavailable'])('refuses %s before creating the original namespace',async route=>{
 const s=store();state.route=route;await expect(s.save(task())).rejects.toThrow('ordinary_source_route');
 expect(existsSync(root)).toBe(false);expect(readOrdinaryProfileSources()).toBeUndefined();
});
it.each(['save','saveWithReceipt','clearActiveTask'] as const)('rechecks %s on the existing instance and keeps all prior bytes on refusal',async method=>{
 const s=store();await s.save(task());const checkpoint=join(root,'snapshots','task-a.json'),index=join(root,'active-task.json');
 const before=readFileSync(checkpoint),priorIndex=readFileSync(index);state.route='pending';
 const work=method==='clearActiveTask'?s.clearActiveTask('task-a'):s[method]({...task(),updatedAt:3});
 await expect(work).rejects.toThrow('ordinary_source_route');expect(readFileSync(checkpoint)).toEqual(before);
 expect(readFileSync(index)).toEqual(priorIndex);expect(existsSync(join(root,'.task-store.save.lock'))).toBe(false);
});
it('releases the actual held Task lock when the last route check rejects',async()=>{
 const registry=join(state.home,'.xiaok','profile-sources','registry.json'),registryLock=join(state.home,'.xiaok','profile-sources','.profile-source-registry.lock');
 state.read=()=>{if(existsSync(registry)&&existsSync(join(root,'.task-store.save.lock'))&&!existsSync(registryLock))state.route='pending';};
 await expect(store().save(task())).rejects.toThrow('ordinary_source_route');
 expect(existsSync(join(root,'.task-store.save.lock'))).toBe(false);expect(existsSync(join(root,'snapshots'))).toBe(false);
});
it('checks identity again after the final route reader and never writes into its replacement',async()=>{
 const registry=join(state.home,'.xiaok','profile-sources','registry.json'),registryLock=join(state.home,'.xiaok','profile-sources','.profile-source-registry.lock');let changed=false;
 state.read=()=>{if(!changed&&existsSync(registry)&&existsSync(join(root,'.task-store.save.lock'))&&!existsSync(registryLock)){
  changed=true;renameSync(root,root+'-original');mkdirSync(root);writeFileSync(join(root,'.task-store.save.lock'),'foreign');
 }};
 await expect(store().save(task())).rejects.toThrow(/identity_changed/);expect(changed).toBe(true);
 expect(existsSync(join(root,'snapshots'))).toBe(false);expect(existsSync(join(root+'-original','snapshots'))).toBe(false);
 expect(readFileSync(join(root,'.task-store.save.lock'),'utf8')).toBe('foreign');
});
it('finishes an admitted lock-held write after pending, but refuses the next queued write',async()=>{
 const s=store(root,{onWrite:(operation:string)=>{if(operation==='checkpoint')state.route='pending';}});
 const first=s.save(task()),second=s.save(task('task-b'));await first;await expect(second).rejects.toThrow('ordinary_source_route');
 expect(await s.getActiveTasks()).toEqual([{taskId:'task-a'}]);expect(existsSync(join(root,'snapshots','task-b.json'))).toBe(false);
 expect(existsSync(join(root,'.task-store.save.lock'))).toBe(false);
});
it('refuses corrupt actual registry before any checkpoint and releases its Task lock',async()=>{
 const directory=join(state.home,'.xiaok','profile-sources');mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'registry.json'),'{}');
 await expect(store().save(task())).rejects.toThrow('profile_source_registry_schema');
 expect(existsSync(join(root,'snapshots'))).toBe(false);expect(existsSync(join(root,'.task-store.save.lock'))).toBe(false);
});
it('reads missing ordinary history without writing a registry or source directory',async()=>{
 const s=store();expect(await s.getActiveTasks()).toEqual([]);expect(await s.hasThreadHistory('missing')).toBe(false);
 expect(existsSync(root)).toBe(false);expect(readOrdinaryProfileSources()).toBeUndefined();
});
