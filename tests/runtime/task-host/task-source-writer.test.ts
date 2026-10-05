import {afterEach,expect,it,vi} from 'vitest';
const gate=vi.hoisted(()=>({enter:undefined as undefined|(()=>void),wait:undefined as undefined|Promise<void>}));
vi.mock('node:fs/promises',async original=>{const actual=await original<typeof import('node:fs/promises')>();return{...actual,async writeFile(...args:Parameters<typeof actual.writeFile>){if(gate.wait&&String(args[0]).includes('/snapshots/')){gate.enter?.();await gate.wait;}return actual.writeFile(...args);}};});
import {mkdtempSync,rmSync,readFileSync,writeFileSync,unlinkSync,renameSync,mkdirSync,existsSync} from 'node:fs';
import {tmpdir,userInfo} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import type {TaskSnapshot} from '../../../src/runtime/task-host/types.js';
const roots:string[]=[];
function snap(taskId='task'):TaskSnapshot{return{taskId,sessionId:'session',status:'running',prompt:'original',materials:[],events:[],createdAt:1,updatedAt:2};}
function setup(){const root=mkdtempSync(join(tmpdir(),'task-writer-'));roots.push(root);return{root,store:new FileTaskSnapshotStore(root)};}
function pause(){let release!:()=>void,entered!:()=>void;gate.wait=new Promise<void>(r=>release=r);const ready=new Promise<void>(r=>entered=r);gate.enter=entered;return{ready,release(){gate.wait=undefined;release();}};}
afterEach(()=>{gate.wait=undefined;gate.enter=undefined;for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
it('holds the original root lock through actual IO against another process',async()=>{
 const{root,store}=setup(),hold=pause();const writing=store.save(snap());await hold.ready;
 try{const module=pathToFileURL(resolve('src/runtime/task-host/snapshot-store.ts')).href;
 const script=`import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';const account=os.userInfo();os.userInfo=()=>({...account,homedir:${JSON.stringify(userInfo().homedir)}});syncBuiltinESMExports();const {FileTaskSnapshotStore}=await import(${JSON.stringify(module)});const store=new FileTaskSnapshotStore(${JSON.stringify(root)});for(const write of [()=>store.save(${JSON.stringify(snap('other'))}),()=>store.clearActiveTask('task')]){try{await write();process.stdout.write('wrote');}catch(e){process.stdout.write(e.message+'\\n');}}`;
 const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{encoding:'utf8',timeout:20000});
 expect(child.status,child.stderr).toBe(0);expect(child.stdout.match(/session_save_locked/g)).toHaveLength(2);expect(child.stdout).not.toContain('wrote');
 }finally{hold.release();await writing;}
 await new FileTaskSnapshotStore(root).save(snap('other'));expect((await store.getActiveTasks()).map(x=>x.taskId).sort()).toEqual(['other','task']);
});
it('captures queued input before caller mutation',async()=>{
 const{store}=setup(),hold=pause();const first=store.save(snap());await hold.ready;const input=snap('other'),second=store.save(input);input.prompt='mutated';hold.release();await Promise.all([first,second]);expect((await store.recoverTask('other'))?.prompt).toBe('original');
});
it('closes admission while keeping accepted physical writes in drain',async()=>{
 const{store}=setup(),hold=pause();const writing=store.save(snap());await hold.ready;
 try{expect(typeof store.closeAndDrain).toBe('function');let drained=false;const closing=store.closeAndDrain().then(()=>{drained=true;});await expect(store.save(snap('new'))).rejects.toThrow('task_store_closed');await Promise.resolve();expect(drained).toBe(false);hold.release();await writing;await closing;expect(drained).toBe(true);}finally{hold.release();await writing;}
});

it('does not release a replacement lock or issue a receipt',async()=>{
 const{root,store}=setup(),hold=pause();const pending=store.saveWithReceipt(snap());await hold.ready;
 const lock=join(root,'.task-store.save.lock'),bytes=readFileSync(lock,'utf8');unlinkSync(lock);const foreign=JSON.stringify({...JSON.parse(bytes),nonce:'00000000-0000-4000-8000-000000000001'});writeFileSync(lock,foreign);
 hold.release();await expect(pending).rejects.toThrow('task_store_identity_changed');expect(readFileSync(lock,'utf8')).toBe(foreign);
});
it('rejects a replaced root and leaves both original and foreign locks',async()=>{
 const{root,store}=setup(),hold=pause();const pending=store.saveWithReceipt(snap());await hold.ready;const moved=root+'-moved';roots.push(moved);renameSync(root,moved);mkdirSync(join(root,'snapshots'),{recursive:true});writeFileSync(join(root,'.task-store.save.lock'),'foreign');
 hold.release();await expect(pending).rejects.toThrow('task_store_identity_changed');expect(readFileSync(join(root,'.task-store.save.lock'),'utf8')).toBe('foreign');expect(existsSync(join(moved,'.task-store.save.lock'))).toBe(true);
});
it('reloads another writer history and the shared index under the same root lock',async()=>{
 const{root,store}=setup(),other=new FileTaskSnapshotStore(root);await store.save(snap());
 const event={type:'assistant_text',text:'new',timestamp:3} as unknown as TaskSnapshot['events'][number];
 await other.save({...snap(),events:[event]});await other.save(snap('other'));
 await expect(store.save(snap())).rejects.toThrow();await store.clearActiveTask('task');expect((await other.getActiveTasks()).map(x=>x.taskId)).toEqual(['other']);
});

it('does not replace a damaged shared index with a guessed empty set',async()=>{
 const{root,store}=setup();await store.save(snap());writeFileSync(join(root,'active-task.json'),'{broken');await expect(store.clearActiveTask('task')).rejects.toThrow();expect(readFileSync(join(root,'active-task.json'),'utf8')).toBe('{broken');
});
it('rejects malformed legacy index but still migrates real string and null',async()=>{
 const{root,store}=setup();writeFileSync(join(root,'active-task.json'),JSON.stringify({activeTaskId:123}));await expect(store.clearActiveTask('task')).rejects.toThrow('task_store_index_invalid');expect(JSON.parse(readFileSync(join(root,'active-task.json'),'utf8'))).toEqual({activeTaskId:123});
 writeFileSync(join(root,'active-task.json'),JSON.stringify({activeTaskId:'other'}));await store.clearActiveTask('task');expect(await store.getActiveTasks()).toEqual([{taskId:'other'}]);
 writeFileSync(join(root,'active-task.json'),JSON.stringify({activeTaskId:null}));await store.clearActiveTask('task');expect(await store.getActiveTasks()).toEqual([]);
});
