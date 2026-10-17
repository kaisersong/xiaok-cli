import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {chmodSync,mkdirSync,mkdtempSync,realpathSync,readFileSync,readdirSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const boundary=vi.hoisted(()=>({home:''}));
const io=vi.hoisted(()=>({write:undefined as undefined|((path:string)=>Promise<void>),sync:undefined as undefined|((path:string)=>Promise<void>),faultSync:undefined as Error|undefined,faultClose:undefined as Error|undefined,temporary:new Set<number>(),paths:new Map<number,string>(),swap:false,faultParent:undefined as Error|undefined,parents:new Set<number>()}));
vi.mock('node:fs/promises',async load=>{
 const actual=await load<typeof import('node:fs/promises')>();
 return {...actual,writeFile:async(...args:Parameters<typeof actual.writeFile>)=>{await actual.writeFile(...args);await io.write?.(String(args[0]));},open:async(...args:Parameters<typeof actual.open>)=>{const handle=await actual.open(...args),sync=handle.sync.bind(handle);handle.sync=async()=>{await io.sync?.(String(args[0]));await sync();};return handle;}};
});
vi.mock('node:fs',async load=>{
 const actual=await load<typeof import('node:fs')>();
 return {...actual,openSync:(...args:Parameters<typeof actual.openSync>)=>{const fd=actual.openSync(...args);if(String(args[0]).includes('writer-fences')&&String(args[0]).endsWith('.tmp')){io.temporary.add(fd);io.paths.set(fd,String(args[0]));}if(String(args[0]).endsWith('writer-fences')&&actual.fstatSync(fd).isDirectory())io.parents.add(fd);return fd;},fsyncSync:(fd:number)=>{if(io.parents.has(fd)&&io.faultParent)throw io.faultParent;if(io.temporary.has(fd)&&io.faultSync)throw io.faultSync;actual.fsyncSync(fd);},closeSync:(fd:number)=>{if(io.temporary.has(fd)&&io.faultClose)throw io.faultClose;actual.closeSync(fd);const path=io.paths.get(fd);if(path&&io.swap){io.swap=false;const data=actual.readFileSync(path);actual.renameSync(path,path+'.displaced');actual.writeFileSync(path,data,{mode:0o600});}io.temporary.delete(fd);io.paths.delete(fd);io.parents.delete(fd);}};
});
vi.mock('node:os',async load=>{const actual=await load<typeof import('node:os')>();return {...actual,userInfo:()=>({...actual.userInfo(),homedir:boundary.home})};});
vi.mock('../../../src/runtime/verification/migration-markers.js',()=>({readInstalledCurrentProfile:()=>({kind:'ordinary'})}));
import {createKnownDirectoryWriterFence} from '../../../src/runtime/verification/known-directory-writer-fence.js';
import {FileGoalStore} from '../../../src/runtime/goal/file-store.js';
import {createGoalState} from '../../../src/runtime/goal/reducer.js';
import {readOrdinaryProfileSources,registerOrdinaryProfileSource} from '../../../src/runtime/verification/ordinary-profile-source-registry.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import type {TaskSnapshot} from '../../../src/runtime/task-host/types.js';
let root:string;
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'known-task-fence-')));boundary.home=join(root,'account');mkdirSync(boundary.home,{mode:0o750});chmodSync(boundary.home,0o750);mkdirSync(join(boundary.home,'.xiaok'),{mode:0o755});chmodSync(join(boundary.home,'.xiaok'),0o755);mkdirSync(join(boundary.home,'.xiaok/profile-sources'),{mode:0o700});});
afterEach(()=>{io.write=undefined;io.sync=undefined;io.faultSync=undefined;io.faultClose=undefined;io.temporary.clear();io.paths.clear();io.swap=false;io.faultParent=undefined;io.parents.clear();rmSync(root,{recursive:true,force:true});});
const snapshot=(taskId:string):TaskSnapshot=>({taskId,sessionId:'session-original',status:'running',prompt:'original',materials:[],events:[],createdAt:1,updatedAt:2});
type Fencable={fenceKnownWriter(source:'user'|'agent'|'scheduler'):Promise<void>};
it('persists the original task writer fence and rejects actual rebuilt and independent process writes without changing original data',async()=>{
 const directory=join(root,'task-source'),store=new FileTaskSnapshotStore(directory);await store.save(snapshot('task-original'));const file=join(directory,'snapshots/task-original.json'),before=readFileSync(file);
 const fence=(store as unknown as Fencable).fenceKnownWriter;expect(fence).toBeTypeOf('function');await fence.call(store,'user');
 const markers=readdirSync(join(boundary.home,'.xiaok/profile-sources/writer-fences'));expect(markers.filter(name=>name.endsWith('.json'))).toHaveLength(1);
 await expect(new FileTaskSnapshotStore(directory).save({...snapshot('task-original'),prompt:'rebuilt'})).rejects.toThrow(/fenc/i);expect(readFileSync(file)).toEqual(before);
 const script=join(root,'restarted-task.mjs');writeFileSync(script,`import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';const userInfo=os.userInfo.bind(os);os.userInfo=()=>({...userInfo(),homedir:${JSON.stringify(boundary.home)}});syncBuiltinESMExports();const {FileTaskSnapshotStore}=await import(${JSON.stringify(pathToFileURL(join(process.cwd(),'src/runtime/task-host/snapshot-store.ts')).href)});try{await new FileTaskSnapshotStore(${JSON.stringify(directory)}).save(${JSON.stringify({...snapshot('task-original'),prompt:'child'})});throw Error('unexpected actual write');}catch(error){if(!/fenc/i.test(String(error)))throw error;}`);
 const result=await new Promise<{code:number|null;stderr:string}>((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx',script],{cwd:process.cwd(),stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',data=>stderr+=data);child.once('error',reject);child.once('close',code=>resolve({code,stderr}));});expect(result.code,result.stderr).toBe(0);expect(readFileSync(file)).toEqual(before);
 await new FileTaskSnapshotStore(join(root,'other-source')).save(snapshot('other-task'));
});

it('keeps actual0750 home and0755 xiaok unchanged and does not create anything for an absent readonly fence probe',async()=>{
 const before=readdirSync(join(boundary.home,'.xiaok/profile-sources'));createKnownDirectoryWriterFence(join(root,'uncreated'),'task-root').assertOpen();expect(readdirSync(join(boundary.home,'.xiaok/profile-sources'))).toEqual(before);expect(statSync(boundary.home).mode&0o777).toBe(0o750);expect(statSync(join(boundary.home,'.xiaok')).mode&0o777).toBe(0o755);await new FileTaskSnapshotStore(join(root,'uncreated')).save(snapshot('first-write'));expect(readdirSync(join(boundary.home,'.xiaok/profile-sources'))).not.toContain('writer-fences');
});
it('does not seal or write for agent scheduler fake owner or Windows unsupported admission',async()=>{
 const store=new FileTaskSnapshotStore(join(root,'source'));await store.save(snapshot('source'));const fence=(store as unknown as Fencable).fenceKnownWriter;for(const source of ['agent','scheduler'] as const)await expect(fence.call(store,source)).rejects.toThrow('request_source');await expect(Reflect.apply(fence,store,['user','extra'])).rejects.toThrow('owner');let read=false;await expect(fence.call({get rootDir(){read=true;return root;}} as unknown as Fencable,'user')).rejects.toThrow('owner');expect(read).toBe(false);const platform=vi.spyOn(process,'platform','get').mockReturnValue('win32');try{await expect(fence.call(store,'user')).rejects.toThrow('platform');}finally{platform.mockRestore();}await store.save({...snapshot('source'),prompt:'still-admitted'});expect(readdirSync(join(boundary.home,'.xiaok/profile-sources'))).not.toContain('writer-fences');
});
it('publishes only one complete source population for two real kinds in the same directory and never replaces it on scope drift',async()=>{
 const directory=join(root,'shared'),task=new FileTaskSnapshotStore(directory),goal=new FileGoalStore(directory),state=createGoalState({sessionId:'goal-shared',objective:'original',expectedEvidenceKinds:['answer'],now:1});await task.save(snapshot('shared-task'));await goal.commit({sessionId:'goal-shared',expectedRevision:null,next:state,events:[],turns:[],evidence:[]});await Promise.all([(task as unknown as Fencable).fenceKnownWriter('user'),(goal as unknown as Fencable).fenceKnownWriter('user')]);const dir=join(boundary.home,'.xiaok/profile-sources/writer-fences'),names=readdirSync(dir).filter(name=>name.endsWith('.json'));expect(names).toHaveLength(1);const marker=join(dir,names[0]!),before=readFileSync(marker),inode=statSync(marker).ino;expect(JSON.parse(before.toString()).sourceIds).toEqual(readOrdinaryProfileSources()!.sources.filter(source=>source.directory.canonicalPath===directory).map(source=>source.sourceId).sort());expect(JSON.parse(before.toString()).sourceIds).toHaveLength(2);
 await expect(new FileTaskSnapshotStore(directory).clearActiveTask('shared-task')).rejects.toThrow(/fenc/);await expect(new FileGoalStore(directory).commit({sessionId:'goal-shared',expectedRevision:state.revision,next:{...state,revision:2},events:[],turns:[],evidence:[]})).rejects.toThrow(/fenc/);
 registerOrdinaryProfileSource({kind:'session-root',directory});await expect((task as unknown as Fencable).fenceKnownWriter('user')).rejects.toThrow('record_conflict');expect(readFileSync(marker)).toEqual(before);expect(statSync(marker).ino).toBe(inode);
});
it('never treats an actual symlink metadata ancestor as absent before a real task write',async()=>{
 const outside=join(root,'outside');mkdirSync(outside,{mode:0o700});symlinkSync(outside,join(boundary.home,'.xiaok/profile-sources/writer-fences'));const store=new FileTaskSnapshotStore(join(root,'blocked'));await expect(store.save(snapshot('blocked'))).rejects.toThrow('directory');expect(readdirSync(outside)).toEqual([]);
});

for(const phase of ['write','sync'] as const)it(`waits original accepted Task ${phase} IO and all queued saves before publishing while refusing new admission`,async()=>{
 const directory=join(root,'held-'+phase),store=new FileTaskSnapshotStore(directory);let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(done=>enter=done),gate=new Promise<void>(done=>release=done);let once=false;
 io[phase]=async path=>{if(!once&&path.includes('snapshots')){once=true;enter();await gate;}};
 const first=store.saveWithReceipt(snapshot('accepted-first')),second=store.save(snapshot('accepted-second'));await entered;let settled=false;const fencing=store.fenceKnownWriter('user');void fencing.then(()=>settled=true,()=>settled=true);await expect(store.save(snapshot('late'))).rejects.toThrow('closed');await new Promise<void>(done=>setImmediate(done));expect(settled).toBe(false);expect(readdirSync(join(boundary.home,'.xiaok/profile-sources'))).not.toContain('writer-fences');release();await Promise.all([first,second]);await fencing;expect((await store.recoverTask('accepted-first'))?.prompt).toBe('original');expect((await store.recoverTask('accepted-second'))?.prompt).toBe('original');await expect(new FileTaskSnapshotStore(directory).save(snapshot('late'))).rejects.toThrow(/fenc/);
});
it('retains actual fsync and unknown-close errors and the pending denial without deleting foreign temporary files',async()=>{
 const directory=join(root,'failed-publication'),store=new FileTaskSnapshotStore(directory);await store.save(snapshot('original'));const file=join(directory,'snapshots/original.json'),before=readFileSync(file),syncError=Error('actual_fsync_failed'),closeError=Error('actual_close_unknown');io.faultSync=syncError;io.faultClose=closeError;
 const failure=await store.fenceKnownWriter('user').catch(error=>error);expect(failure).toBeInstanceOf(AggregateError);expect(failure.errors).toEqual([syncError,closeError]);expect(failure.cause).toBe(syncError);const metadata=join(boundary.home,'.xiaok/profile-sources/writer-fences'),pending=readdirSync(metadata);expect(pending.filter(name=>name.endsWith('.tmp'))).toHaveLength(1);await expect(new FileTaskSnapshotStore(directory).save(snapshot('late'))).rejects.toThrow('pending');expect(readFileSync(file)).toEqual(before);
 const foreign=join(metadata,'.foreign.tmp');writeFileSync(foreign,'foreign',{mode:0o600});io.faultSync=undefined;io.faultClose=undefined;await store.fenceKnownWriter('user');expect(readFileSync(foreign,'utf8')).toBe('foreign');expect(readdirSync(metadata)).toContain(pending[0]);await expect(store.save(snapshot('late'))).rejects.toThrow('closed');
});

it('rejects replacement of the actual closed temporary inode before link publication and preserves the displaced original',async()=>{
 const store=new FileTaskSnapshotStore(join(root,'swapped'));await store.save(snapshot('original'));io.swap=true;await expect(store.fenceKnownWriter('user')).rejects.toThrow('temporary_changed');const metadata=join(boundary.home,'.xiaok/profile-sources/writer-fences'),names=readdirSync(metadata);expect(names.filter(name=>name.endsWith('.json'))).toHaveLength(0);expect(names.filter(name=>name.endsWith('.displaced'))).toHaveLength(1);
});

it('denies actual corrupt, wrong-mode and hardlinked existing fence records while preserving source bytes and inode',async()=>{
 const directory=join(root,'invalid-record'),store=new FileTaskSnapshotStore(directory);await store.save(snapshot('original'));await store.fenceKnownWriter('user');const metadata=join(boundary.home,'.xiaok/profile-sources/writer-fences'),marker=join(metadata,readdirSync(metadata).find(name=>name.endsWith('.json'))!),original=readFileSync(marker),inode=statSync(marker).ino,file=join(directory,'snapshots/original.json'),data=readFileSync(file);
 chmodSync(marker,0o644);await expect(store.fenceKnownWriter('user')).rejects.toThrow('record');await expect(new FileTaskSnapshotStore(directory).save(snapshot('late'))).rejects.toThrow('fenced');chmodSync(marker,0o600);
 const {linkSync,unlinkSync}=await import('node:fs');const extra=join(root,'linked-record');linkSync(marker,extra);await expect(store.fenceKnownWriter('user')).rejects.toThrow('record');unlinkSync(extra);
 writeFileSync(marker,'{broken');await expect(store.fenceKnownWriter('user')).rejects.toThrow('record_conflict');await expect(new FileTaskSnapshotStore(directory).save(snapshot('late'))).rejects.toThrow('fenced');expect(statSync(marker).ino).toBe(inode);expect(readFileSync(file)).toEqual(data);writeFileSync(marker,original);await store.fenceKnownWriter('user');
});

it('retains the published create-only target when real parent fsync fails and confirms it only on a successful retry',async()=>{
 const directory=join(root,'parent-sync'),store=new FileTaskSnapshotStore(directory);await store.save(snapshot('original'));const error=Error('actual_parent_fsync_failed');io.faultParent=error;await expect(store.fenceKnownWriter('user')).rejects.toBe(error);const metadata=join(boundary.home,'.xiaok/profile-sources/writer-fences'),names=readdirSync(metadata);expect(names.filter(name=>name.endsWith('.tmp'))).toHaveLength(0);expect(names.filter(name=>name.endsWith('.json'))).toHaveLength(1);const marker=join(metadata,names[0]!),before=readFileSync(marker),inode=statSync(marker).ino;expect(statSync(marker).nlink).toBe(1);await expect(new FileTaskSnapshotStore(directory).save(snapshot('late'))).rejects.toThrow('fenced');io.faultParent=undefined;await store.fenceKnownWriter('user');expect(readFileSync(marker)).toEqual(before);expect(statSync(marker).ino).toBe(inode);
});
