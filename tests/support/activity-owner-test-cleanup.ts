import {spawn,ChildProcess,type SpawnOptions} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {dirname,relative,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as schedule,clearTimeout as cancel} from 'node:timers';
import type {ActivityOwnerSpawner} from '../../src/runtime/conversation-activity/owner-launcher.js';
const originalSpawn=spawn,originalKill=ChildProcess.prototype.kill;
const originalOwnerEntry=fileURLToPath(new URL('../../src/runtime/conversation-activity/owner-entry.js',import.meta.url));
type Birth={configPath:string;child?:ChildProcess;pid?:number;closed:boolean;code:number|null;signal:NodeJS.Signals|null;close:Promise<void>;resolveClose():void;constructorFailure?:{raw:unknown}};
function canonical(path:string):string{try{return realpathSync(path);}catch(error){if(!['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))throw error;const parent=dirname(path);if(parent===path)throw error;return resolve(canonical(parent),relative(parent,path));}}
function inside(root:string,target:string):boolean{const rel=relative(canonical(root),canonical(target));return rel===''||!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+(process.platform==='win32'?'\\':'/'));}
/** Fixture resource custody only. No Native grant, business authority or whole-domain proof. */
export function createActivityOwnerTestScope(roots:()=>readonly string[]){
 const births:Birth[]=[],launches=new Set<Promise<void>>();let sealed=false,closing:Promise<void>|undefined;
 function checkRoot(path:string){if(!roots().some(root=>inside(root,path)))throw Error('fixture_activity_owner_outside_owned_root');}
 function spawner():ActivityOwnerSpawner{return (command,args,options:SpawnOptions)=>{
  if(sealed)throw Error('fixture_activity_owner_scope_closed');
  if(command!==process.execPath||args.length!==2||typeof args[0]!=='string'||resolve(args[0])!==originalOwnerEntry||typeof args[1]!=='string')throw Error('fixture_activity_owner_original_argv_required');
  checkRoot(args[1]);let resolveClose!:()=>void;const close=new Promise<void>(done=>{resolveClose=done;});
  // Reserve the row before the actual spawn. A failed constructor is not an empty healthy scope.
  const row:Birth={configPath:canonical(args[1]),closed:false,code:null,signal:null,close,resolveClose};births.push(row);
  try{
   const child=originalSpawn(command,args,options);row.child=child;row.pid=child.pid;
   child.once('close',(code,signal)=>{row.closed=true;row.code=code;row.signal=signal;row.resolveClose();console.log(JSON.stringify({kind:'fixture-activity-owner-close',pid:row.pid,configPath:row.configPath,code,signal}));});
   console.log(JSON.stringify({kind:'fixture-activity-owner-birth',pid:row.pid,configPath:row.configPath}));return child;
  }catch(raw){row.constructorFailure={raw};throw raw;}
 };}
 function runOriginalLaunch<T>(dataRoot:string,original:(spawn:ActivityOwnerSpawner)=>Promise<T>):Promise<T>{
  if(sealed)return Promise.reject(Error('fixture_activity_owner_scope_closed'));checkRoot(dataRoot);
  let done!:()=>void;const completion=new Promise<void>(resolve=>{done=resolve;});launches.add(completion);
  try{const raw=original(spawner());void raw.then(()=>{launches.delete(completion);done();},()=>{launches.delete(completion);done();});return raw;}
  catch(raw){launches.delete(completion);done();throw raw;}
 }
 function assertClosed(){const pending=births.filter(row=>!row.closed);if(pending.length||launches.size)throw Error(`fixture_activity_owner_live_births:${pending.length}:pending_launches:${launches.size}`);}
 function waitClosed(row:Birth):Promise<void>{if(row.closed)return Promise.resolve();return new Promise<void>((yes,no)=>{const timer=schedule(()=>no(Error('fixture_activity_owner_close_unconfirmed')),5000);void row.close.then(()=>{cancel(timer);yes();},error=>{cancel(timer);no(error);});});}
 function close():Promise<void>{
  if(closing)return closing;sealed=true;
  closing=Promise.resolve().then(async()=>{
   const failures:unknown[]=[];
   // Original handles only: never infer ownership from a process name or kill a reused attachment.
   for(const row of births){if(row.closed)continue;if(row.constructorFailure){failures.push(row.constructorFailure.raw);continue;}if(!row.child){failures.push(Error('fixture_activity_owner_handle_unconfirmed'));continue;}
    if(row.child.exitCode===null&&row.child.signalCode===null&&row.pid!==undefined)try{Reflect.apply(originalKill,row.child,['SIGTERM']);}catch(raw){failures.push(raw);}
   }
   const joined=await Promise.allSettled(births.filter(row=>!row.constructorFailure).map(waitClosed));for(const result of joined)if(result.status==='rejected')failures.push(result.reason);
   // Seal blocked late constructors above; original entered attachment polls must still settle.
   const pending=await Promise.allSettled([...launches]);for(const result of pending)if(result.status==='rejected')failures.push(result.reason);
   try{assertClosed();}catch(raw){failures.push(raw);}
   if(failures.length)throw new AggregateError(failures,'fixture_activity_owner_cleanup_failed');
  });return closing;
 }
 return Object.freeze({runOriginalLaunch,close,assertClosed,assertOwnedPath:checkRoot});
}
export type ActivityOwnerTestScope=ReturnType<typeof createActivityOwnerTestScope>;
