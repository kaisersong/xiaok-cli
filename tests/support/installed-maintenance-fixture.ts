import {installedControllerFixture,installedControllerStartupFixture,type InstalledControllerFixtureOptions} from './installed-controller-fixture.js';
import {randomUUID,createHash} from 'node:crypto';
import {join,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {rmSync} from 'node:fs';
import {vi} from 'vitest';
import type {Database} from 'better-sqlite3';
import * as handoff from '../../src/runtime/verification/installed-maintenance-handoff.js';
import * as stack from '../../src/runtime/verification/installed-execution-stack.js';
import type {QuiescenceExpectation} from '../../src/runtime/isolated-execution/physical-quiescence.js';
import {canonicalVerificationJson as json} from '../../src/runtime/verification/protocol.js';
import {buildPrivateMacEnginePlan} from '../../src/runtime/verification/macos-engine-bootstrap.js';
import {ENGINE_BINARY_CENSUS_SCRIPT} from '../../src/runtime/verification/engine-binary-census.js';
import {createEngineBootstrapJournal,readExistingEngineBootstrap} from '../../src/runtime/verification/engine-bootstrap-journal.js';

const osLeaf=vi.hoisted(()=>{
 const base:'/Library/Application Support/xiaok-verification'='/Library/Application Support/xiaok-verification';
 return {base,physicalRoot:undefined as string|undefined,
 files:new Map<string,string>(),socket:'',dockerSocket:undefined as string|undefined,uid:502,drift:false,release:'',inventory:new WeakSet<object>(),
 binaries:[] as {name:string;sha256:string;size:number}[],commands:[] as {executable:unknown;argv:unknown;stdin:unknown;step:number;outcome:'pending'|'ok'|'drift'|'rejected'}[],
 cycle:[] as {id:string;executable:string;argv:readonly string[];stdin:string;output:string}[],commandCursor:0,completeCycles:0,failedDrift:false,traceStart:0,commandEnv:{} as Readonly<Record<string,string>>,
 fds:new Map<number,string>(),boot:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'};
});
vi.mock('node:fs',async()=>{
 const actual=await vi.importActual<typeof import('node:fs')>('node:fs');
 const declared=new Set(['mkdirSync','readFileSync','writeFileSync','lstatSync','statSync','realpathSync','existsSync','openSync','closeSync','fsyncSync','fstatSync','readSync','writeSync','readdirSync','unlinkSync','rmdirSync','renameSync','chmodSync']);
 const text=(p:any):string|undefined=>typeof p==='string'?p:Buffer.isBuffer(p)?p.toString():p instanceof URL?fileURLToPath(p):undefined;
 function canonical(p:any){const value=text(p);return value!==undefined&&(value===osLeaf.base||value.startsWith(osLeaf.base+'/'));}
 function physical(p:any){
  if(!canonical(p))return p;
  const value=text(p)!;
  if(!osLeaf.physicalRoot||resolve(value)!==value)throw Error('maintenance_fixture_fs_scope');
  const destination=join(osLeaf.physicalRoot,relative(osLeaf.base,value)),suffix=relative(osLeaf.physicalRoot,destination);
  if(suffix==='..'||suffix.startsWith('..'+sep))throw Error('maintenance_fixture_fs_escape');
  // Existing symlink parents may not turn a lexical sandbox path into /Library
  // or another task directory. A nonexistent leaf is checked at its parent.
  let parent:string=destination;
  while(!actual.existsSync(parent)){const next=resolve(parent,'..');if(next===parent)throw Error('maintenance_fixture_fs_missing_root');parent=next;}
  const real=actual.realpathSync(parent),within=relative(osLeaf.physicalRoot,real);
  if(within==='..'||within.startsWith('..'+sep))throw Error('maintenance_fixture_fs_symlink_escape');
  return destination;
 }
 const scriptedStat=(p:string)=>({size:Buffer.byteLength(osLeaf.files.get(p)??''),uid:osLeaf.uid,gid:20,nlink:1,mode:p===osLeaf.socket?0o140600:0o100600,
  isFile:()=>p!==osLeaf.socket,isDirectory:()=>false,isSocket:()=>p===osLeaf.socket,isSymbolicLink:()=>false});
 const cache=new Map<PropertyKey,unknown>();
 const wrap=(key:string,fn:any)=>(...args:any[])=>{
  const mapped=canonical(args[0]),logical=text(args[0]);
  if(!declared.has(key)&&args.some(a=>canonical(a)||typeof a==='number'&&osLeaf.fds.has(a)))throw Error('maintenance_fixture_fs_api:'+key);
  if(mapped&&key==='readFileSync'&&osLeaf.files.has(logical!)){
   const bytes=Buffer.from(osLeaf.files.get(logical!)!),encoding=typeof args[1]==='string'?args[1]:args[1]?.encoding;
   return encoding?bytes.toString(encoding):bytes;
  }
  if(mapped&&(key==='lstatSync'||key==='statSync')&&(osLeaf.files.has(logical!)||logical===osLeaf.socket))return scriptedStat(logical!);
  if(mapped&&key==='openSync'&&(osLeaf.files.has(logical!)||logical===osLeaf.socket))throw Error('maintenance_fixture_scripted_open_forbidden');
  const passed=[...args];
  if(mapped)passed[0]=physical(args[0]);
  if(key==='renameSync'){if(mapped!==canonical(args[1]))throw Error('maintenance_fixture_cross_namespace_rename');passed[1]=physical(args[1]);}
  if(key==='realpathSync'&&mapped){
   const result=actual.realpathSync(passed[0]),suffix=relative(osLeaf.physicalRoot!,result);
   if(suffix==='..'||suffix.startsWith('..'+sep))throw Error('maintenance_fixture_realpath_escape');
   const value=join(osLeaf.base,suffix);return args[1]==='buffer'||args[1]?.encoding==='buffer'?Buffer.from(value):value;
  }
  const result=fn(...passed);
  if(key==='openSync'&&mapped)osLeaf.fds.set(result,logical!);
  if(key==='closeSync')osLeaf.fds.delete(args[0]);
  return result;
 };
 const proxy:any=new Proxy(actual,{get(target,key){
  if(key==='default')return proxy;
  if(key==='promises')return new Proxy(actual.promises,{get(p,k){const fn=Reflect.get(p,k);if(typeof fn!=='function')return fn;return(...args:any[])=>{if(args.some(canonical))throw Error('maintenance_fixture_fs_promises_api:'+String(k));return fn(...args);};}});
  const value=Reflect.get(target,key);if(typeof value!=='function')return value;
  if(!cache.has(key)){const wrapped:any=wrap(String(key),value);if(key==='realpathSync')wrapped.native=wrapped;cache.set(key,wrapped);}
  return cache.get(key);
 }});return proxy;
});
vi.mock('node:fs/promises',async()=>{
 const actual=await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
 const proxy:any=new Proxy(actual,{get(target,key){if(key==='default')return proxy;const value=Reflect.get(target,key);if(typeof value!=='function')return value;return(...args:any[])=>{if(args.some(p=>{const path=typeof p==='string'?p:Buffer.isBuffer(p)?p.toString():p instanceof URL?fileURLToPath(p):undefined;return path!==undefined&&(path===osLeaf.base||path.startsWith(osLeaf.base+'/'));}))throw Error('maintenance_fixture_unmapped_promise_fs');return value(...args);};}});return proxy;
});
vi.mock('node:net',async()=>{
 const actual=await vi.importActual<typeof import('node:net')>('node:net');
 function path(p:string){if(p===osLeaf.dockerSocket)return p;if(p!==osLeaf.base&&!p.startsWith(osLeaf.base+'/'))return p;if(!osLeaf.physicalRoot||resolve(p)!==p)throw Error('maintenance_fixture_socket_scope');return join(osLeaf.physicalRoot,relative(osLeaf.base,p));}
 function args(values:any[]){const result=[...values];if(typeof result[0]==='string')result[0]=path(result[0]);else if(result[0]&&typeof result[0].path==='string')result[0]={...result[0],path:path(result[0].path)};return result;}
 return {...actual,createServer(...input:any[]){const server=(actual.createServer as any)(...input),listen=server.listen;server.listen=function(...input:any[]){return listen.apply(this,args(input));};return server;},createConnection(...input:any[]){return(actual.createConnection as any)(...args(input));},connect(...input:any[]){return(actual.connect as any)(...args(input));}};
});
vi.mock('../../src/runtime/verification/deployment-package.js',async original=>{
 const actual=await original<any>();return {...actual,parseDeploymentPackageInventory(input:any){if(input?.r1152OSLeaf===true&&input.packageHash==='a'.repeat(64)){const value={packageHash:input.packageHash};osLeaf.inventory.add(value);return value;}return actual.parseDeploymentPackageInventory(input);},verifyDeploymentPackage(release:string,inventory:object){if(osLeaf.inventory.has(inventory)&&release===osLeaf.release&&osLeaf.physicalRoot)return;return actual.verifyDeploymentPackage(release,inventory);}};
});
vi.mock('../../src/runtime/verification/installation-command.js',async original=>{
 const actual=await original<any>();return {...actual,assertInstallationCommandIdle(scope:string){if(scope!==osLeaf.base+'/state'||!osLeaf.physicalRoot||osLeaf.commandCursor!==0||osLeaf.failedDrift)throw Error('maintenance_fixture_os_scope');},async runInstallationCommand(input:any){
  const trace={executable:input.executable,argv:Array.isArray(input.argv)?[...input.argv]:input.argv,stdin:input.stdin,step:osLeaf.commandCursor,outcome:'pending' as 'pending'|'ok'|'drift'|'rejected'};osLeaf.commands.push(trace);
  try{
   const expected=osLeaf.cycle[osLeaf.commandCursor];
   if(!osLeaf.physicalRoot||input.scope!==osLeaf.base+'/state'||input.cwd!==input.scope||input.timeoutMs!==30000||typeof input.assertCurrent!=='function'||!input.signal||json(input.env)!==json(osLeaf.commandEnv))throw Error('maintenance_fixture_os_scope');
   if(Object.keys(input).sort().join(',')!=='argv,assertCurrent,cwd,env,executable,scope,signal,stdin,timeoutMs')throw Error('maintenance_fixture_os_input_fields');
   if(!expected||input.executable!==expected.executable||!Array.isArray(input.argv)||input.argv.length!==expected.argv.length||input.argv.some((v:unknown,i:number)=>v!==expected.argv[i])||input.stdin!==expected.stdin)throw Error('maintenance_fixture_os_exact_command:'+String(osLeaf.commandCursor));
   if(osLeaf.failedDrift)throw Error('maintenance_fixture_os_after_terminal');
   if(osLeaf.drift){if(osLeaf.commandCursor!==0)throw Error('maintenance_fixture_os_mid_census_drift');osLeaf.failedDrift=true;trace.outcome='drift';throw Error('actual attachment changed');}
   trace.outcome='ok';osLeaf.commandCursor++;
   if(osLeaf.commandCursor===osLeaf.cycle.length){osLeaf.commandCursor=0;osLeaf.completeCycles++;}
   return Buffer.from(expected.output);
  }catch(error){if(trace.outcome==='pending')trace.outcome='rejected';throw error;}
 }};
});

/** Exactly one ordered nine-command read-only census. No fragment matching.
 * A later inspect repeats this whole cycle; extra/reordered steps reject. */
function maintenanceCommandCycle(plan:ReturnType<typeof buildPrivateMacEnginePlan>,sources:{workerImage:{imageId:string}},uid:number){
 const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
 const directory=join(osLeaf.base,'state/lima',plan.name),observer=join(osLeaf.release,'bin/process-observation');
 const docker='/usr/local/lib/xiaok-engine/docker --host unix:///run/xiaok-engine/docker.sock';
 const process=json({uid,realUid:uid,executable:join(osLeaf.release,'bin/qemu-system-aarch64'),startIdentity:'r1152-existing-process'});
 const step=(id:string,executable:string,argv:readonly string[],stdin:string,output:string)=>({id,executable,argv:[...argv],stdin,output});
 const shell=(id:string,stdin:string,output:string)=>step(id,plan.executable,['shell',plan.name,'sudo','-n','/bin/sh','-s'],stdin,output);
 return [
  step('validate-config',plan.executable,['validate','--fill',plan.configPath],'','r1152-normalized'),
  step('process-before',observer,['123'],'',process),
  step('validate-lima',plan.executable,['validate','--fill',join(directory,'lima.yaml')],'','r1152-normalized'),
  shell('guest-ids','set -eu\ncat /etc/machine-id\ncat /proc/sys/kernel/random/boot_id\ncat /etc/xiaok-controller-creation-nonce\n','1'.repeat(32)+'\n'+osLeaf.boot+'\n'+'c'.repeat(64)+'\n'),
  shell('engine-info',`${docker} info --format '{{json .}}'\n`,json({ID:'r1152-existing-engine',OSType:'linux',Architecture:'aarch64'})),
  shell('service-unit',`set -eu\n[ ! -L /etc/systemd/system/xiaok-engine.service ]\nprintf '%s  %s\\n' '${hash(plan.unit)}' '/etc/systemd/system/xiaok-engine.service' | sha256sum -c - >/dev/null\nsystemctl is-active --quiet xiaok-engine.service\n`,''),
  shell('binary-census',ENGINE_BINARY_CENSUS_SCRIPT,osLeaf.binaries.map(x=>`${x.name} ${x.sha256} 0 0 755 1 ${x.size}`).join('\n')+'\n'),
  shell('image-inspect',`${docker} image inspect '${sources.workerImage.imageId}' --format '{{.Id}}'\n`,sources.workerImage.imageId+'\n'),
  step('process-after',observer,['123'],'',process),
 ];
}
function assertOSCommandTrace(allowDrift=false){
 const trace=osLeaf.commands.slice(osLeaf.traceStart),size=osLeaf.cycle.length;
 if(size!==9||osLeaf.commandCursor!==0||osLeaf.completeCycles<1||osLeaf.failedDrift!==allowDrift||trace.length!==osLeaf.completeCycles*size+(allowDrift?1:0))throw Error('maintenance_fixture_os_trace_population');
 for(let i=0;i<trace.length;i++){
  const item=trace[i],expected=osLeaf.cycle[i%size],drift=allowDrift&&i===trace.length-1;
  if(item.step!==i%size||item.outcome!==(drift?'drift':'ok')||item.executable!==expected.executable||json(item.argv)!==json(expected.argv)||item.stdin!==expected.stdin)throw Error('maintenance_fixture_os_trace_sequence');
 }
}

function engineLeaves(imageId:string,input:Parameters<NonNullable<InstalledControllerFixtureOptions['logicalOS']>['prepare']>[0],logical:boolean){
 const {physicalRoot,database,manifest,reopening}=input,H='a'.repeat(64),hash=(v:string)=>createHash('sha256').update(v).digest('hex');
 if(manifest.packageHash!==H||logical!==reopening)throw Error('maintenance_fixture_os_package_or_mode');
 if(osLeaf.fds.size)throw Error('maintenance_fixture_os_open_descriptors');
 osLeaf.uid=manifest.serviceUid;osLeaf.release=join(osLeaf.base,'releases',H);
 const sources={baseImage:{sha256:'e'.repeat(64)},engine:{sha256:'f'.repeat(64)},workerImage:{sha256:imageId.slice('sha256:'.length),imageId}};
 const plan=buildPrivateMacEnginePlan({stateRoot:join(osLeaf.base,'state'),releaseRoot:osLeaf.release,baseImageSha256:sources.baseImage.sha256,dockerArchiveSha256:sources.engine.sha256,creationNonce:'c'.repeat(64)});
 if(!reopening){
  // Only OS bootstrap journal producers. Normal lifetime/DB paths stay physical.
  const journal=createEngineBootstrapJournal(database),proposal={deploymentHash:H,configHash:hash('r1152-normalized'),creationNonce:'c'.repeat(64),vmName:'xiaok-engine' as const},vm={machineId:'1'.repeat(32),bootId:osLeaf.boot,creationNonce:proposal.creationNonce,effectiveConfigHash:proposal.configHash,processUid:manifest.serviceUid,processStartIdentity:'r1152-existing-process'};
  journal.prepare(proposal);journal.beginCreate(proposal);journal.recordVm(proposal,vm);
  for(const [name,digest] of [['copy-engine',sources.engine.sha256],['install-engine',hash(plan.bootstrapScript)],['load-worker',sources.workerImage.sha256]] as const){journal.phase(proposal,name,digest);journal.phase(proposal,name,digest,true);}
  journal.recordObservation(proposal,{...vm,engineId:'r1152-existing-engine'});
 }else{
  // Only maintenance reopen activates the canonical Node-fs namespace. Native
  // SQLite has already been opened by the fixture at physicalRoot/state.
  osLeaf.physicalRoot=physicalRoot;osLeaf.files.clear();osLeaf.socket=plan.hostSocket;
  osLeaf.binaries=['containerd','containerd-shim-runc-v2','ctr','docker','docker-init','docker-proxy','dockerd','runc'].map(name=>({name,sha256:'f'.repeat(64),size:1}));
  for(const [path,body] of [[join(osLeaf.base,'releases',H+'.json'),json({r1152OSLeaf:true,packageHash:H})],[join(osLeaf.release,'runtime-sources.json'),json(sources)],[join(osLeaf.release,'vm/engine-files.json'),json(osLeaf.binaries)],[plan.configPath,plan.configJson],[join(osLeaf.base,'state/lima',plan.name,'qemu.pid'),'123'],[join(osLeaf.base,'state/lima',plan.name,'lima.yaml'),plan.configJson]])osLeaf.files.set(path,body);
  osLeaf.cycle=maintenanceCommandCycle(plan,sources,manifest.serviceUid);osLeaf.commandEnv=plan.env;osLeaf.commandCursor=0;osLeaf.completeCycles=0;osLeaf.failedDrift=false;osLeaf.traceStart=osLeaf.commands.length;
 }
 const existing=readExistingEngineBootstrap(database);
 const hostSocket=logical?plan.hostSocket:osLeaf.dockerSocket;
 if(!hostSocket)throw Error('maintenance_fixture_normal_socket_missing');
 return {hostSocket,engineBinding:{engineId:existing.observation.engineId,incarnation:hash(json(existing.observation))}};
}
function logicalOSLeaves(imageId:string):NonNullable<InstalledControllerFixtureOptions['logicalOS']>{
 return {base:osLeaf.base,assertExecutable(path){if(![join(osLeaf.release,'bin/process-observation'),join(osLeaf.release,'bin/limactl')].includes(path))throw Error('maintenance_fixture_os_executable');},prepare(input){return engineLeaves(imageId,input,true);}};
}

type NormalFixture=Awaited<ReturnType<typeof installedControllerFixture>>;

/** Only the original normal producer, without an extra operation/run/transcript.
 * Maintenance selection, request persistence, tickets and restart are never
 * simulated here. The root owns the real budget, material stager and raw runner.
 */
export async function prepareInstalledMaintenanceOriginal(options:{
 socketPath:string;imageId:string;materialBytes:Buffer;
}){
 if(osLeaf.physicalRoot||osLeaf.fds.size)throw Error('maintenance_fixture_previous_namespace_active');
 osLeaf.drift=false;osLeaf.commands=[];osLeaf.dockerSocket=options.socketPath;
 const f=await installedControllerFixture({docker:{socketPath:options.socketPath,imageId:options.imageId},materialBytes:options.materialBytes,normalEngineBaseline:input=>engineLeaves(options.imageId,input,false)});
 const invocation={sessionIdentity:'session',compoundOperationId:randomUUID(),validationInvocationId:randomUUID()},signal=new AbortController().signal;
 const command={argv:['/bin/true'],cwdRelative:'.'};
 const recipe={kind:'artifact-content' as const,checks:[{id:'original',path:'result',sha256:createHash('sha256').update('original').digest('hex'),structure:'bytes' as const}]};
 let expected:QuiescenceExpectation|undefined,challengeId:string|undefined;
 let dispatch:Promise<unknown>|undefined,closing:Promise<void>|undefined;
 let resourceId:string|undefined,retired=false;
 // Rejections are retained and joined; attaching a handler only prevents a late
 // rejection from escaping before close reaches that exact producer promise.
 const owned=new Map<Promise<unknown>,{label:string;failure?:{error:unknown}}>();
 function observe<T>(label:string,work:Promise<T>):Promise<T>{
  const record:{label:string;failure?:{error:unknown}}={label};owned.set(work,record);
  void work.catch(error=>{record.failure={error};});return work;
 }
 async function joinOwned(){
  const work=[...owned.keys()];await Promise.allSettled(work);
  return work.flatMap(p=>{const r=owned.get(p)!;return r.failure?[new Error(r.label,{cause:r.failure.error})]:[];});
 }
 function retireMaterial(){
  if(!challengeId)throw Error('maintenance_fixture_material_missing');
  if(!retired){f.material.revoke(challengeId,f.peer);retired=true;}
 }
 function resource(){if(!resourceId)throw Error('maintenance_fixture_resource_missing');return resourceId;}
 function execution(){if(!expected)throw Error('maintenance_fixture_execution_missing');return expected;}
 async function closeOwned(primary?:{error:unknown}){
  const errors:unknown[]=primary?[primary.error]:[];
  for(const error of await joinOwned())errors.push(error);
  // Normal failure cleanup only. Do not use this to hand off an interrupted
  // cleanup: the restart integration must join its request and call root.close.
  if(expected)try{await f.raw.cleanupExecution(expected);}catch(error){errors.push(new Error('maintenance_fixture_raw_cleanup',{cause:error}));}
  if(resourceId)try{retireMaterial();await f.stack.privateHost.materialCleanup.cleanupResource(resourceId);}catch(error){errors.push(new Error('maintenance_fixture_material_cleanup',{cause:error}));}
  try{await f.close(errors.length>0);}catch(error){errors.push(new Error('maintenance_fixture_root_close',{cause:error}));}
  if(errors.length)throw new AggregateError(errors,'maintenance_fixture_cleanup:'+f.root);
 }
 function close(primary?:{error:unknown}){return closing??=closeOwned(primary);}
 function closeOriginalForRestart(interruption:Error){
  return closing??=(async()=>{
   const failures=await joinOwned(),known=[...owned.values()].filter(r=>r.failure);
   const errors:unknown[]=known.filter(r=>r.failure!.error!==interruption).map(r=>new Error(r.label,{cause:r.failure!.error}));
   if(!known.some(r=>r.failure!.error===interruption))errors.push(Error('maintenance_fixture_original_interruption_not_observed'));
   // Do not retry an intentionally interrupted cleanup or delete its target.
   // Only the real root may determine drain/seal; this fixture supplies no
   // boolean, target list, replacement issuer or persistent completion fact.
   try{await f.close(true);}catch(error){errors.push(new Error('maintenance_fixture_original_root_close',{cause:error}));}
   if(errors.length)throw new AggregateError([...failures,...errors],'maintenance_fixture_restart_close:'+f.root);
  })();
 }
 try{
  const compiled=f.composition.privateHost.recipes.compile(recipe),enrollment=f.composition.privateHost.enrollment;
  const owner=enrollment.prepare({enrollment:{ownerKind:'task',ownerId:'maintenance-live-'+randomUUID(),invocations:[invocation]},registration:{migrationEpoch:1,
   obligations:[{obligation:{obligationId:'original',predicateId:'original',predicateVersion:'1',semantics:'current-subject',definitionHash:compiled.definitionHash,requiredCheckIds:compiled.requiredCheckIds},recipe}],source:{kind:'new-owner'}}},f.peer);
  await enrollment.authorize(owner.challengeId,f.peer,signal);
  const challenge=await f.material.prepare({purpose:'isolated-command',invocation,materials:[{path:join(f.root,'fixture-input'),byteLimit:100}],exactCommand:command,expiresAt:105000},f.peer,signal);
  challengeId=challenge.challengeId;
  const grant=await f.material.authorize(challenge.challengeId,f.peer,signal),staged=await f.material.stage({grantHandle:grant,invocation},f.peer,signal);
  const {plan}=f.material.consumeMountPlan(staged.mountPlanHandle,f.peer);
  const rows=f.database.prepare<[],{resource_id:string;scope_digest:string}>('SELECT resource_id,scope_digest FROM broker_staging_intents').all();
  if(rows.length!==1||rows[0].scope_digest!==staged.scopeDigest)throw Error('maintenance_fixture_original_staging_population');
  resourceId=rows[0].resource_id;
  const ownerKey=enrollment.resolveOwnerKey(f.peer,invocation),reserved=f.raw.reserveExecution({...invocation,ownerKey,scopeDigest:staged.scopeDigest,command:staged.command,materializedInput:plan});
  expected=reserved.expected;
  dispatch=observe('maintenance_fixture_original_dispatch',f.raw.dispatchExecution(expected));
  await dispatch;
  const attempts=f.database.prepare<[],{execution_id:string}>('SELECT execution_id FROM execution_attempts').all();
  const resources=f.database.prepare<[],{execution_id:string}>('SELECT execution_id FROM docker_runner_resources').all();
  if(attempts.length!==1||resources.length!==1||attempts[0].execution_id!==expected.executionIdentity||resources[0].execution_id!==expected.executionIdentity)throw Error('maintenance_fixture_original_execution_population');
  const allocations=f.database.prepare<[],{kind:string;resource_id:string}>("SELECT kind,resource_id FROM verification_blob_reservations WHERE state='reserved'").all();
  if(allocations.length!==3||allocations.filter(x=>x.kind==='host-staging'&&x.resource_id===resourceId).length!==1||allocations.filter(x=>x.kind==='guest-input').length!==1||allocations.filter(x=>x.kind==='guest-output').length!==1)throw Error('maintenance_fixture_original_allocation_population');
  return {fixture:f,invocation,command:staged.command,plan,scopeDigest:staged.scopeDigest,
   expected:execution(),resourceId:resource(),retireMaterial,
   // These call only the exact original producer; an observer may pause the
   // future core's real persist function but must never fabricate a request.
   requestRawCleanup(){return observe('maintenance_fixture_requested_raw_cleanup',f.raw.cleanupExecution(execution()));},
   requestMaterialCleanup(){retireMaterial();return observe('maintenance_fixture_requested_material_cleanup',f.stack.privateHost.materialCleanup.cleanupResource(resource()));},
   async cleanupOriginalMaterial(){retireMaterial();await observe('maintenance_fixture_normal_material_cleanup',f.stack.privateHost.materialCleanup.cleanupResource(resource()));
    const reserved=f.database.prepare<[],{n:number}>("SELECT COUNT(*) n FROM verification_blob_reservations WHERE state='reserved'").get();
    if(reserved?.n!==2)throw Error('maintenance_fixture_original_raw_two');
   },
   async joinOriginalWork(){return joinOwned();},
   closeOriginalForRestart,close,
  };
 }catch(error){await close({error});throw error;}
}

export type InstalledMaintenanceOriginal=Awaited<ReturnType<typeof prepareInstalledMaintenanceOriginal>>;
export type InstalledMaintenanceNormalRoot=NormalFixture;

/** Test-only observation of R1151's exact fixed persist, after the original has
 * really committed. No command is minted here and no handoff row is written.
 * Other DBs/non-installed no-op sources cannot consume this fixture's fault.
 */
type OriginalCleanupTarget={kind:'raw';expected:QuiescenceExpectation}|{kind:'material';resourceId:string};
export function interruptOriginalMaintenanceRequests(input:{database:Database;authorityId:string;originEpoch:string;targets:readonly OriginalCleanupTarget[]}){
 const {database}=input,actual=handoff.persistInstalledMaintenanceRequest,interruption=Error('maintenance_fixture_after_actual_persist');
 const hash=(value:unknown)=>createHash('sha256').update(json(value)).digest('hex');
 const key=(value:OriginalCleanupTarget)=>hash({kind:value.kind,resourceId:value.kind==='raw'?value.expected.executionIdentity:value.resourceId});
 const targets=new Map<string,OriginalCleanupTarget>(input.targets.map(value=>[key(value),value]));
 if(!targets.size||targets.size!==input.targets.length)throw Error('maintenance_fixture_target_population');
 const seen=new Set<string>(),observations:{itemId:string;targetHash:string;ordinal:number}[]=[];
 let current:string|undefined;
 function snapshot(allowMissing=false){
  if(database.inTransaction)throw Error('maintenance_fixture_persist_not_committed');
  if(!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='verification_maintenance_handoff_items'").get()){
   if(allowMissing)return new Map<string,string>();
   throw Error('maintenance_fixture_request_table_missing');
  }
  const rows=database.prepare<[string,string],{item_id:string;target_json:string;target_hash:string;outcome:string;evidence_hash:string|null;phase:string;claim_epoch:string|null}>(`SELECT i.item_id,i.target_json,i.target_hash,i.outcome,i.evidence_hash,h.phase,h.claim_epoch
   FROM verification_maintenance_handoff_items i JOIN verification_maintenance_handoffs h USING(authority_id,origin_epoch)
   WHERE i.authority_id=? AND i.origin_epoch=? ORDER BY i.item_id`).all(input.authorityId,input.originEpoch);
  const requested=new Map<string,string>();
  for(const row of rows){
   const target=JSON.parse(row.target_json),known=targets.get(row.item_id);
   if(!known){if(row.outcome==='requested')throw Error('maintenance_fixture_unexpected_requested_target');continue;}
   if(known.kind!==target.kind||(known.kind==='raw'?known.expected.executionIdentity!==target.resourceId||json(known.expected)!==json(target.expected):known.resourceId!==target.resourceId||target.expected!==null))throw Error('maintenance_fixture_target_identity');
   if(json(target)!==row.target_json||row.target_hash!==hash(target)||row.item_id!==hash({kind:target.kind,resourceId:target.resourceId})||requested.has(row.item_id))throw Error('maintenance_fixture_target_identity');
   if(row.phase!=='requested'||row.claim_epoch!==null||row.outcome!=='requested'||row.evidence_hash!==null)throw Error('maintenance_fixture_target_not_requested');
   requested.set(row.item_id,row.target_hash);
  }
  return requested;
 }
 if(snapshot(true).size)throw Error('maintenance_fixture_preexisting_target_request');
 const observer=vi.spyOn(handoff,'persistInstalledMaintenanceRequest').mockImplementation(command=>{
  actual(command); // Opaque command is never read. Only committed table facts follow.
  const requested=snapshot();
  for(const itemId of requested.keys())if(itemId!==current&&!seen.has(itemId))throw Error('maintenance_fixture_unselected_target_request');
  if(current){
   const targetHash=requested.get(current);
   if(!targetHash)throw Error('maintenance_fixture_current_request_not_matched');
   seen.add(current);observations.push({itemId:current,targetHash,ordinal:observations.length+1});
  }else if(!requested.size)throw Error('maintenance_fixture_committed_request_not_matched');
  // This also cuts idempotent retries of an already requested target, regardless
  // of total_changes. No prior material row can establish a first raw cut.
  throw interruption;
 });
 return {interruption,get observations(){return observations.map(value=>({...value}));},
  async interrupt(target:OriginalCleanupTarget,work:()=>Promise<unknown>){
   const itemId=key(target);
   if(current||!targets.has(itemId)||seen.has(itemId))throw Error('maintenance_fixture_request_cut_selection');
   const before=snapshot(true);
   if(before.size!==seen.size||[...before.keys()].some(id=>!seen.has(id)))throw Error('maintenance_fixture_request_cut_changed');
   current=itemId;
   try{
    try{await work();}catch(error){if(error!==interruption)throw error;if(!seen.has(itemId))throw Error('maintenance_fixture_current_cut_not_observed');return;}
    throw Error('maintenance_fixture_original_request_not_interrupted');
   }finally{current=undefined;}
  },
  assertComplete(){
   if(current)throw Error('maintenance_fixture_request_cut_busy');
   const requested=snapshot();
   if(seen.size!==targets.size||requested.size!==targets.size||[...targets.keys()].some(id=>!seen.has(id)||!requested.has(id)))throw Error('maintenance_fixture_request_cut_set_incomplete');
  },
  restore(){observer.mockRestore();},
 };
}

/** Observe one root's exact active builder, pausing that same startup promise.
 * The caller must install the ordinary OS/lifetime leaves before starting the
 * zero-argument real root, then always finish(join that same promise) in finally.
 */
export function observeActiveInstalledMaintenanceOwner(){
 type Owner=Awaited<ReturnType<typeof stack.createInstalledMaintenanceStack>>;
 type Lifetime=Parameters<typeof stack.createInstalledMaintenanceStack>[0]['lifetime'];
 let entered!:(value:{owner:Owner;lifetime:Lifetime})=>void,rejectEntered!:(error:unknown)=>void,release!:()=>void;
 const ready=new Promise<{owner:Owner;lifetime:Lifetime}>((resolve,reject)=>{entered=resolve;rejectEntered=reject;}),barrier=new Promise<void>(resolve=>{release=resolve;});
 void ready.catch(()=>{});
 const actual=stack.createInstalledMaintenanceStack;
 let originalStartup:Promise<{close():Promise<void>}>|undefined;
 let enteredCount=0,finishing:Promise<{close():Promise<void>}>|undefined;
 const observer=vi.spyOn(stack,'createInstalledMaintenanceStack').mockImplementation(async input=>{
  try{
   // The original route control's OS identity leaf. Only the synchronous guard
   // prefix is scripted; actual attachment/census and its private brand remain.
   const platform=Object.getOwnPropertyDescriptor(process,'platform')!,arch=Object.getOwnPropertyDescriptor(process,'arch')!;
   let building:ReturnType<typeof actual>;
   try{Object.defineProperty(process,'platform',{value:'darwin'});Object.defineProperty(process,'arch',{value:'arm64'});building=actual(input);}
   finally{Object.defineProperty(process,'platform',platform);Object.defineProperty(process,'arch',arch);}
   const owner=await building;
   if(++enteredCount!==1)throw Error('maintenance_fixture_multiple_active_builders');
   entered({owner,lifetime:input.lifetime});
   await barrier;
   return owner;
  }catch(error){rejectEntered(error);throw error;}
 });
 function bind(startup:Promise<{close():Promise<void>}>){
  if(originalStartup&&originalStartup!==startup)throw Error('maintenance_fixture_startup_promise_changed');
  originalStartup=startup;
 }
 return {
  restoreBeforeStartup(){if(originalStartup||enteredCount)throw Error('maintenance_fixture_startup_already_owned');release();observer.mockRestore();},
  active(startup:Promise<{close():Promise<void>}>){
   bind(startup);
   return Promise.race([ready,startup.then(()=>{throw Error('maintenance_fixture_owner_not_observed');})]);
  },
  finish(startup:Promise<{close():Promise<void>}>){
   bind(startup);release();
   return finishing??=(async()=>{try{return await startup;}finally{observer.mockRestore();}})();
  },
 };
}

/** Full original producer -> sealed root close -> new root's active owner.
 * OS-only scripted leaves issue no OS/native eligibility; Docker stays real.
 */
export async function installedMaintenanceFixture(options:{socketPath:string;imageId:string;kind:'execution'|'staging'}){
 const original=await prepareInstalledMaintenanceOriginal({...options,materialBytes:Buffer.from(options.kind==='staging'?'original':'x')}),f=original.fixture;
 const retainedStartupFailures:{error:unknown;serviceEpoch:string;databaseClosed:true}[]=[];
 let session:Awaited<ReturnType<typeof reopen>>|undefined;
 async function reopen(){
  const observer=observeActiveInstalledMaintenanceOwner();
  let root:Awaited<ReturnType<typeof installedControllerStartupFixture>>;
  try{root=await installedControllerStartupFixture({existingRoot:f.root,expectedReceiverKeys:f.keys,recoveryOnly:true,
   docker:{socketPath:options.socketPath,imageId:options.imageId},logicalOS:logicalOSLeaves(options.imageId),materialBytes:Buffer.from(options.kind==='staging'?'original':'x')});}
  catch(error){observer.restoreBeforeStartup();throw error;}
  const startupCandidate=root.startupPromise;
  if(!startupCandidate){
   const errors:unknown[]=[Error('maintenance_fixture_missing_startup_promise:'+f.root)];
   try{observer.restoreBeforeStartup();}catch(error){errors.push(error);}
   // No startup handle means there is no safe join/close claim. Retain DB/root.
   throw new AggregateError(errors,'maintenance_fixture_missing_startup:'+f.root);
  }
  const startup=startupCandidate; // Already narrowed; closures retain this exact Promise.
  let observed:Awaited<ReturnType<typeof observer.active>>;
  try{observed=await observer.active(startup);assertOSCommandTrace();}catch(error){
   const errors:unknown[]=[error];try{await observer.finish(startup);}catch(joinError){if(!errors.includes(joinError))errors.push(joinError);}
   throw new AggregateError(errors,'maintenance_fixture_startup:'+f.root);
  }
  let joined:Promise<void>|undefined,expectedDrift=false;
  function finish(){return joined??=(async()=>{const installed=await observer.finish(startup);await installed.close();assertOSCommandTrace();})();}
  return {root,execution:observed.owner.privateHost.execution,staging:observed.owner.privateHost.staging,
   database:root.database,finish,
   async finishAfterDrift(){
    try{await finish();}catch(error){
     // Only the actual attachment's latched invalidation, with a truly closed
     // root/DB and no aggregate cleanup errors, is this scenario's expected
     // consumer failure. Its original error object remains in this record.
     if(error instanceof Error&&!(error instanceof AggregateError)&&error.message==='maintenance_engine_invalidated'&&!root.database.open){assertOSCommandTrace(true);expectedDrift=true;retainedStartupFailures.push({error,serviceEpoch:root.lifetime.serviceEpoch,databaseClosed:true});return {error};}
     throw error;
    }
    throw Error('maintenance_fixture_missing_retained_drift');
   },
   async joinedClose(){if(expectedDrift)return;await finish();if(root.database.open)throw Error('maintenance_fixture_root_still_open');},
  };
 }
 try{
  if(options.kind==='execution')await original.cleanupOriginalMaterial();
  const targets=[{kind:'raw' as const,expected:original.expected},...(options.kind==='staging'?[{kind:'material' as const,resourceId:original.resourceId}]:[])];
  const cut=interruptOriginalMaintenanceRequests({database:f.database,authorityId:f.lifetime.manifest.authorityId,originEpoch:f.lifetime.serviceEpoch,targets});
  try{
   if(options.kind==='staging')await cut.interrupt({kind:'material',resourceId:original.resourceId},()=>original.requestMaterialCleanup());
   await cut.interrupt({kind:'raw',expected:original.expected},()=>original.requestRawCleanup());
   cut.assertComplete();
  }finally{cut.restore();}
  await original.closeOriginalForRestart(cut.interruption);
  session=await reopen();
  let closing:Promise<void>|undefined;
  async function closeOwned(primary?:{error:unknown}){
   const errors:unknown[]=primary?[primary.error]:[];
   try{await session?.joinedClose();}catch(error){errors.push(error);}
   if(session?.database.open)errors.push(Error('maintenance_fixture_unresolved_lifetime'));
   if(osLeaf.fds.size)errors.push(Error('maintenance_fixture_open_fs_descriptors'));
   if(!errors.length){rmSync(f.root,{recursive:true,force:true});osLeaf.physicalRoot=undefined;osLeaf.files.clear();}
   if(errors.length)throw new AggregateError(errors,'maintenance_fixture_close:'+f.root);
  }
  return {root:f.root,invocation:original.invocation,scopeDigest:original.scopeDigest,command:original.command,plan:original.plan,expected:original.expected,resourceId:original.resourceId,
   get database(){return session!.database;},get execution(){return session!.execution;},get staging(){return session!.staging;},
   get retainedStartupFailures(){return retainedStartupFailures.slice();},
   get persistObservations(){return cut.observations;},
   get commandTrace(){return osLeaf.commands.map(item=>({...item,argv:Array.isArray(item.argv)?[...item.argv]:item.argv}));},
   setDrift(value:boolean){osLeaf.drift=value;},
   finish(){return session!.finish();},
   finishAfterDrift(){return session!.finishAfterDrift();},
   async restartAfterDrift(){await session!.joinedClose();session=await reopen();},
   close(primary?:{error:unknown}){return closing??=closeOwned(primary);},
  };
 }catch(error){
  const errors:unknown[]=[error];
  try{if(session)await session.joinedClose();else await original.close({error});}catch(cleanup){if(cleanup!==error)errors.push(cleanup);}
  throw new AggregateError(errors,'maintenance_fixture_prepare:'+f.root);
 }
}
