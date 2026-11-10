import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
const controls=vi.hoisted(()=>({root:'',home:'',fault:'none',probes:new Set<number>(),live:new Set<number>(),probeCount:0,closedProbes:0,asyncOpens:[] as Array<{path:string;flags:unknown}>,replacement:'',attached:false,tail:undefined as Promise<void>|undefined,ready:()=>{}}));
vi.mock('node:os',async load=>{const actual=await load<typeof import('node:os')>();return {...actual,userInfo:()=>({...actual.userInfo(),homedir:controls.home})};});
vi.mock('node:fs',async load=>{
 const actual=await load<typeof import('node:fs')>();
 return {...actual,
  lstatSync:(...args:Parameters<typeof actual.lstatSync>)=>{
   const stat=Reflect.apply(actual.lstatSync,actual,args);
   if(controls.root&&String(args[0]).startsWith(controls.root)&&stat.isFile())stat.dev=typeof stat.dev==='bigint'?0n:0;
   return stat;
  },
  openSync:(...args:Parameters<typeof actual.openSync>)=>{
   const fd=Reflect.apply(actual.openSync,actual,args);
   if(controls.root&&String(args[0]).startsWith(controls.root)){controls.live.add(fd);if(args[1]==='r'&&String(args[0]).endsWith('.tmp')){controls.probes.add(fd);controls.probeCount++;}}
   return fd;
  },
  fstatSync:(...args:Parameters<typeof actual.fstatSync>)=>{
   const stat=Reflect.apply(actual.fstatSync,actual,args);
   if(controls.probes.has(args[0])){
    if(controls.fault==='device')stat.dev+=typeof stat.dev==='bigint'?1n:1;
    if(controls.fault==='inode')stat.ino+=typeof stat.ino==='bigint'?1n:1;
    if(controls.fault==='replace'&&!controls.replacement){
     // Locate only this fixture's actual open temp; the test owns its root.
     for(const name of actual.readdirSync(controls.root)){if(name.endsWith('.tmp')){const file=join(controls.root,name);actual.renameSync(file,file+'.original');actual.writeFileSync(file,'foreign replacement');controls.replacement=file;break;}}
    }
    if(controls.fault==='tail'&&!controls.attached){controls.attached=true;Object.defineProperty(stat,Symbol('actual-probe-stat-tail'),{value:controls.tail});controls.ready();}
   }
   return stat;
  },
  closeSync:(fd:number)=>{const result=actual.closeSync(fd);controls.live.delete(fd);if(controls.probes.delete(fd))controls.closedProbes++;return result;},
 };
});
vi.mock('../../../src/runtime/verification/migration-markers.js',async load=>{const actual=await load<typeof import('../../../src/runtime/verification/migration-markers.js')>();return {...actual,readInstalledCurrentProfile:()=>({kind:'ordinary'})};});
vi.mock('node:fs/promises',async load=>{const actual=await load<typeof import('node:fs/promises')>();return {...actual,open:(...args:Parameters<typeof actual.open>)=>{if(controls.root&&(String(args[0]).startsWith(controls.root)||String(args[0])+sep===controls.root))controls.asyncOpens.push({path:String(args[0]),flags:args[1]});return Reflect.apply(actual.open,actual,args);}};});
import {getTaskSnapshotWriteReceipt,FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {setProfileTestHome} from '../../support/profile-home-env.js';
let work='',store:FileTaskSnapshotStore,expectedUnknown=false,release=()=>{};
const task={taskId:'original',sessionId:'session',status:'running' as const,prompt:'Actual Source synchronous temp identity',materials:[],events:[],createdAt:1,updatedAt:2};
beforeEach(()=>{
 work=realpathSync(mkdtempSync(join(tmpdir(),'store-win-temp-')));controls.home=join(work,'account');mkdirSync(controls.home);setProfileTestHome(controls.home);
 controls.root=join(work,'tasks')+sep;controls.fault='none';controls.probes.clear();controls.live.clear();controls.probeCount=0;controls.closedProbes=0;controls.asyncOpens=[];controls.replacement='';controls.attached=false;controls.tail=undefined;controls.ready=()=>{};expectedUnknown=false;release=()=>{};
 store=new FileTaskSnapshotStore(join(work,'tasks'));
});
afterEach(async()=>{
 release();let failure:unknown,denied=false;try{await store.closeAndDrain();if(expectedUnknown)failure=Error('unknown Store incorrectly acknowledged close');}catch(error){denied=true;if(!expectedUnknown)failure=error;}
 expect(controls.live.size).toBe(0);expect(controls.probes.size).toBe(0);
 controls.root='';
 if(expectedUnknown||denied)console.info(JSON.stringify({retainedUnknownRoot:work,physicalClosedNotClaimed:true}));
 else rmSync(work,{recursive:true,force:true,maxRetries:5});
 if(failure)throw failure;
});
it.skipIf(process.platform!=='win32')('uses actual original read handles for zero-device lock cleanup while saving and recovering checkpoints',async()=>{
 await store.save(task);expect(controls.probeCount).toBeGreaterThan(0);expect(controls.closedProbes).toBe(controls.probeCount);
 expect(await store.recoverTask('original')).toMatchObject(task);await store.save({...task,status:'completed'});await store.closeAndDrain();
 expect(existsSync(join(work,'tasks','.task-store.save.lock'))).toBe(false);
});
for(const fault of ['device','inode','replace'])it.skipIf(process.platform!=='win32')(`rejects the actual temp probe ${fault} without deleting a replacement`,async()=>{
 controls.fault=fault;expectedUnknown=true;
 await expect(store.save(task)).rejects.toThrow();expect(controls.probeCount).toBeGreaterThan(0);expect(controls.closedProbes).toBe(controls.probeCount);
 expect(existsSync(join(work,'tasks','snapshots','original.json'))).toBe(false);
 if(fault==='replace'){expect(controls.replacement).not.toBe('');expect(readFileSync(controls.replacement,'utf8')).toBe('foreign replacement');}
});
it.skipIf(process.platform!=='win32')('retains a probe stat own-symbol tail and closes its original fd only after that tail settles',async()=>{
 controls.fault='tail';expectedUnknown=true;
 controls.tail=new Promise<void>(yes=>{release=yes;});const ready=new Promise<void>(yes=>{controls.ready=yes;});
 const writing=store.save(task);void writing.catch(()=>{});await Promise.race([ready,writing.then(()=>{throw Error('probe was never entered');},error=>{throw error;})]);
 let closed=false;const closing=store.closeAndDrain().then(()=>{closed=true;},()=>{closed=true;});
 await new Promise<void>(yes=>setImmediate(yes));expect(closed).toBe(false);expect(controls.probes.size).toBe(1);expect(controls.closedProbes).toBe(0);
 release();await expect(writing).rejects.toThrow();await closing;expect(controls.closedProbes).toBe(1);expect(controls.live.size).toBe(0);
});

it.skipIf(process.platform!=='win32')('flushes actual Windows files and directories with write access before the original exact-write receipt',async()=>{
 await store.save(task);const receipt=await store.saveWithReceipt(task);
 expect(getTaskSnapshotWriteReceipt(receipt,store)).toMatchObject({taskId:task.taskId,sessionId:task.sessionId,status:task.status});
 expect(JSON.parse(readFileSync(join(work,'tasks','snapshots','original.json'),'utf8')).prompt).toBe(task.prompt);
 for(const directory of [join(work,'tasks'),join(work,'tasks','snapshots')]){const opened=controls.asyncOpens.filter(row=>row.path===directory);expect(opened.length).toBeGreaterThan(0);expect(opened.every(row=>row.flags==='r+')).toBe(true);}
 await store.closeAndDrain();
});
