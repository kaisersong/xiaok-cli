import {vi} from 'vitest';
import {mkdtempSync,mkdirSync,realpathSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,generateKeyPairSync,randomUUID} from 'node:crypto';
import type {Database} from 'better-sqlite3';
import type {InstalledControllerLifetime} from '../../src/runtime/verification/installed-controller-lifetime.js';
import type {QuiescenceExpectation} from '../../src/runtime/isolated-execution/physical-quiescence.js';
import type {BlobReservationProposal} from '../../src/runtime/verification/blob-budget.js';
import {openPrivateVerificationDatabase} from '../../src/runtime/verification/private-database.js';
import {startInstalledVerificationController,isInstalledControllerShutdownUnresolved} from '../../src/runtime/verification/installed-controller.js';
import * as installedEngine from '../../src/runtime/verification/installed-engine.js';
import * as qualificationModule from '../../src/runtime/verification/installed-engine-qualification.js';
import * as stack from '../../src/runtime/verification/installed-execution-stack.js';
import * as handoff from '../../src/runtime/verification/installed-maintenance-handoff.js';
import * as shared from '../../src/runtime/verification/installed-shared-capacity.js';
import * as metadata from '../../src/runtime/verification/installed-metadata-source.js';
import {createInstalledProfileIndexPublisher} from '../../src/runtime/verification/installed-migration-publisher.js';
import {ExecutionJournal} from '../../src/runtime/isolated-execution/execution-journal.js';
import {canonicalVerificationJson as json} from '../../src/runtime/verification/protocol.js';
import {buildPrivateMacEnginePlan} from '../../src/runtime/verification/macos-engine-bootstrap.js';
import {ENGINE_BINARY_CENSUS_SCRIPT} from '../../src/runtime/verification/engine-binary-census.js';
import {createEngineBootstrapJournal,readExistingEngineBootstrap} from '../../src/runtime/verification/engine-bootstrap-journal.js';

export type ProbeMode='terminal'|'prepared'|'created'|'missing-record';
type ProbeRecord={expected:QuiescenceExpectation;body:{Image:string;Cmd:string[];Labels:Record<string,string>;HostConfig:object};allocation:BlobReservationProposal;challenge:string;engineHash:string;deleted:boolean};
type RunningCleanupStatus='PASS'|'NOT_PROVEN_ALREADY_TERMINAL'|'NOT_PROVEN_A1_NOT_EXPOSED'|'FAIL_PRIMARY_OR_CLEANUP_UNKNOWN';
type RunningEvent={sequence:number;method:string;stage:'begin'|'end'|'error'|'cut';call:number;parentAbsence?:number;containerId?:string;value?:unknown};
function property(value:unknown,key:string):unknown{return value!==null&&typeof value==='object'?Reflect.get(value,key):undefined;}
function errorEvidence(error:unknown,seen=new Set<unknown>()):unknown{
 if(!(error instanceof Error))return {nonError:error};
 if(seen.has(error))return {circularError:true};seen.add(error);
 return {name:error.name,message:error.message,stack:error.stack,cause:error.cause===undefined?undefined:errorEvidence(error.cause,seen),...(error instanceof AggregateError?{errors:error.errors.map(value=>errorEvidence(value,seen))}:{})};
}
type Command={executable:string;argv:readonly string[];stdin:string;output:string};
const leaf=vi.hoisted(()=>({base:'/Library/Application Support/xiaok-verification',physicalRoot:undefined as string|undefined,physicalDB:'',canonicalDB:'/Library/Application Support/xiaok-verification/state/authority.sqlite',projectionActive:false,markerCalls:0,rootStarted:false,
 files:new Map<string,string>(),socket:'',dockerSocket:undefined as string|undefined,uid:502,release:'',fds:new Map<number,string>(),inventory:new WeakSet<object>(),
 next:undefined as InstalledControllerLifetime|undefined,lifetimes:new WeakSet<object>(),brokers:new WeakMap<object,InstalledControllerLifetime>(),transport:undefined as object|undefined,
 program:[] as Command[],cursor:0,repeat:false,env:{} as Readonly<Record<string,string>>,commands:[] as {executable:unknown;argv:unknown;stdin:unknown;step:number;phase:string;outcome:string}[],phase:'idle',
 forbidden:[] as string[],boot:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'}));
vi.mock('node:fs',async()=>{
 const actual=await vi.importActual<typeof import('node:fs')>('node:fs');
 const declared=new Set(['mkdirSync','readFileSync','writeFileSync','lstatSync','statSync','realpathSync','existsSync','openSync','closeSync','fsyncSync','fstatSync','readSync','writeSync','readdirSync','unlinkSync','rmdirSync','renameSync','chmodSync']);
 const text=(p:any):string|undefined=>typeof p==='string'?p:Buffer.isBuffer(p)?p.toString():p instanceof URL?fileURLToPath(p):undefined;
 function canonical(p:any){const value=text(p);return value!==undefined&&(value===leaf.base||value.startsWith(leaf.base+'/'));}
 function physical(p:any){
  if(!canonical(p))return p;
  const value=text(p)!;
  if(!leaf.physicalRoot||resolve(value)!==value)throw Error('probe_fixture_fs_scope');
  const destination=join(leaf.physicalRoot,relative(leaf.base,value)),suffix=relative(leaf.physicalRoot,destination);
  if(suffix==='..'||suffix.startsWith('..'+sep))throw Error('probe_fixture_fs_escape');
  // Existing symlink parents may not turn a lexical sandbox path into /Library
  // or another task directory. A nonexistent leaf is checked at its parent.
  let parent:string=destination;
  while(!actual.existsSync(parent)){const next=resolve(parent,'..');if(next===parent)throw Error('probe_fixture_fs_missing_root');parent=next;}
  const real=actual.realpathSync(parent),within=relative(leaf.physicalRoot,real);
  if(within==='..'||within.startsWith('..'+sep))throw Error('probe_fixture_fs_symlink_escape');
  return destination;
 }
 const scriptedStat=(p:string)=>({size:Buffer.byteLength(leaf.files.get(p)??''),uid:leaf.uid,gid:20,nlink:1,mode:p===leaf.socket?0o140600:0o100600,
  isFile:()=>p!==leaf.socket,isDirectory:()=>false,isSocket:()=>p===leaf.socket,isSymbolicLink:()=>false});
 const cache=new Map<PropertyKey,unknown>();
 const wrap=(key:string,fn:any)=>(...args:any[])=>{
  if(key==='realpathSync'&&leaf.projectionActive&&typeof args[0]==='string'&&(args[0]===leaf.physicalDB||args[0]===leaf.canonicalDB)){
   const stat=actual.lstatSync(leaf.physicalDB);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('probe_fixture_db_identity');
   if(actual.realpathSync(leaf.physicalDB)!==leaf.physicalDB)throw Error('probe_fixture_db_symlink');
   return args[1]==='buffer'||args[1]?.encoding==='buffer'?Buffer.from(leaf.canonicalDB):leaf.canonicalDB;
  }
  const mapped=canonical(args[0]),logical=text(args[0]);
  if(key==='realpathSync'&&mapped&&logical===leaf.canonicalDB)throw Error('probe_fixture_nonexact_db_alias');
  if(!declared.has(key)&&args.some(a=>canonical(a)||typeof a==='number'&&leaf.fds.has(a)))throw Error('probe_fixture_fs_api:'+key);
  if(mapped&&key==='existsSync'&&leaf.files.has(logical!))return true;
  if(mapped&&key==='readFileSync'&&leaf.files.has(logical!)){
   const bytes=Buffer.from(leaf.files.get(logical!)!),encoding=typeof args[1]==='string'?args[1]:args[1]?.encoding;
   return encoding?bytes.toString(encoding):bytes;
  }
  if(mapped&&(key==='lstatSync'||key==='statSync')&&(leaf.files.has(logical!)||logical===leaf.socket))return scriptedStat(logical!);
  if(mapped&&key==='openSync'&&(leaf.files.has(logical!)||logical===leaf.socket))throw Error('probe_fixture_scripted_open_forbidden');
  const passed=[...args];
  if(mapped)passed[0]=physical(args[0]);
  if(key==='renameSync'){if(mapped!==canonical(args[1]))throw Error('probe_fixture_cross_namespace_rename');passed[1]=physical(args[1]);}
  if(key==='realpathSync'&&mapped){
   const result=actual.realpathSync(passed[0]),suffix=relative(leaf.physicalRoot!,result);
   if(suffix==='..'||suffix.startsWith('..'+sep))throw Error('probe_fixture_realpath_escape');
   const value=join(leaf.base,suffix);return args[1]==='buffer'||args[1]?.encoding==='buffer'?Buffer.from(value):value;
  }
  const result=fn(...passed);
  if(key==='openSync'&&mapped)leaf.fds.set(result,logical!);
  if(key==='closeSync')leaf.fds.delete(args[0]);
  return result;
 };
 const proxy:any=new Proxy(actual,{get(target,key){
  if(key==='default')return proxy;
  if(key==='promises')return new Proxy(actual.promises,{get(p,k){const fn=Reflect.get(p,k);if(typeof fn!=='function')return fn;return(...args:any[])=>{if(args.some(canonical))throw Error('probe_fixture_fs_promises_api:'+String(k));return fn(...args);};}});
  const value=Reflect.get(target,key);if(typeof value!=='function')return value;
  if(!cache.has(key)){const wrapped:any=wrap(String(key),value);if(key==='realpathSync')wrapped.native=wrapped;cache.set(key,wrapped);}
  return cache.get(key);
 }});return proxy;
});
vi.mock('node:fs/promises',async()=>{
 const actual=await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
 const proxy:any=new Proxy(actual,{get(target,key){if(key==='default')return proxy;const value=Reflect.get(target,key);if(typeof value!=='function')return value;return(...args:any[])=>{if(args.some(p=>{const path=typeof p==='string'?p:Buffer.isBuffer(p)?p.toString():p instanceof URL?fileURLToPath(p):undefined;return path!==undefined&&(path===leaf.base||path.startsWith(leaf.base+'/'));}))throw Error('probe_fixture_unmapped_promise_fs');return value(...args);};}});return proxy;
});
vi.mock('node:net',async()=>{
 const actual=await vi.importActual<typeof import('node:net')>('node:net');
 function path(p:string){if(p===leaf.dockerSocket)return p;if(p!==leaf.base&&!p.startsWith(leaf.base+'/'))return p;if(!leaf.physicalRoot||resolve(p)!==p)throw Error('probe_fixture_socket_scope');return join(leaf.physicalRoot,relative(leaf.base,p));}
 function args(values:any[]){const result=[...values];if(typeof result[0]==='string')result[0]=path(result[0]);else if(result[0]&&typeof result[0].path==='string')result[0]={...result[0],path:path(result[0].path)};return result;}
 return {...actual,createServer(...input:any[]){const server=(actual.createServer as any)(...input),listen=server.listen;server.listen=function(...input:any[]){return listen.apply(this,args(input));};return server;},createConnection(...input:any[]){return(actual.createConnection as any)(...args(input));},connect(...input:any[]){return(actual.connect as any)(...args(input));}};
});
function unexpected(name:string):never{leaf.forbidden.push(name);throw Error('probe_fixture_unexpected:'+name);}
vi.mock('../../src/runtime/verification/installed-controller-lifetime.js',()=>({
 createInstalledControllerLifetime(){if(!leaf.next)throw Error('probe_fixture_missing_lifetime');leaf.next.assertCurrent();return leaf.next;},
 assertInstalledControllerLifetime(value:InstalledControllerLifetime){if(!leaf.lifetimes.has(value))throw Error('probe_fixture_lifetime_identity');value.assertCurrent();},
}));
vi.mock('../../src/runtime/verification/installed-identity.js',async original=>({...await original<any>(),
 assertRootProtectedFile(path:string){
  if(!leaf.physicalRoot||!leaf.files.has(path)&&![join(leaf.physicalRoot,'deployment.json'),join(leaf.physicalRoot,'receiver.json')].includes(path))throw Error('probe_fixture_os_file');
 },
 assertRootProtectedExecutable(path:string){if(!leaf.physicalRoot||![join(leaf.release,'bin/node'),join(leaf.release,'bin/limactl'),join(leaf.release,'bin/process-observation'),join(leaf.physicalRoot,'releases','a'.repeat(64),'bin/node')].includes(path))throw Error('probe_fixture_os_executable');},
 assertInstalledControllerIdentity(input:{serviceUid:number;interactiveUids:readonly number[];executable:string;stateRoot:string}){
  if(!leaf.physicalRoot||input.serviceUid!==502||input.interactiveUids.join(',')!=='501'||![join(leaf.base,'state'),join(leaf.physicalRoot,'state')].includes(input.stateRoot)||![join(leaf.release,'bin/node'),join(leaf.physicalRoot,'releases','a'.repeat(64),'bin/node')].includes(input.executable))throw Error('probe_fixture_os_identity');
 },
}));
// One test-owned OS directory premise only; publisher DB/state and metadata
// guards remain actual. This supplies no native ownership/ACL qualification.
vi.mock('../../src/runtime/verification/migration-markers.js',async original=>{
 const actual=await original<any>(),fs=await vi.importActual<typeof import('node:fs')>('node:fs');
 return {...actual,assertServiceProtectedMarkerPath(path:string,policy:{root:string;serviceUid:number;kind:'file'|'directory'}){
  const root=leaf.physicalRoot,lifetime=leaf.next;
  if(!root||!lifetime||leaf.rootStarted||leaf.markerCalls!==0||lifetime.base!==root||lifetime.state!==join(root,'state')||path!==join(root,'migrations')||!policy||Reflect.ownKeys(policy).length!==3||!Reflect.ownKeys(policy).every(key=>key==='kind'||key==='root'||key==='serviceUid')||policy.root!==path||leaf.uid!==502||policy.serviceUid!==leaf.uid||policy.serviceUid!==lifetime.manifest.serviceUid||policy.kind!=='directory')throw Error('probe_fixture_marker_scope');
  lifetime.assertCurrent();
  const own=fs.lstatSync(root),marker=fs.lstatSync(path);
  if(!own.isDirectory()||own.isSymbolicLink()||!marker.isDirectory()||marker.isSymbolicLink()||fs.realpathSync(root)!==root||fs.realpathSync(path)!==path)throw Error('probe_fixture_marker_identity');
  leaf.markerCalls++;
 }};
});
vi.mock('../../src/runtime/verification/root-broker-client.js',()=>({
 createInstalledRootBrokerClient(){const lifetime=leaf.next;if(!lifetime)throw Error('probe_fixture_missing_lifetime');
  const broker=new Proxy(Object.freeze({dispose(){}}),{get(target,key){if(key==='dispose')return target.dispose;if(key==='then')return undefined;return()=>unexpected('broker.'+String(key));}});
  leaf.brokers.set(broker,lifetime);return broker;
 },
 assertInstalledRootBrokerClient(value:object,lifetime:InstalledControllerLifetime){if(leaf.brokers.get(value)!==lifetime)throw Error('probe_fixture_broker_identity');lifetime.assertCurrent();},
}));
vi.mock('../../src/runtime/isolated-execution/docker-engine-transport.js',()=>({DockerEngineTransport:class{
 constructor(input:{socketPath:string}){if(input.socketPath!==leaf.socket||!leaf.transport)throw Error('probe_fixture_docker_endpoint');return leaf.transport;}
}}));
vi.mock('../../src/runtime/verification/deployment-package.js',async original=>{
 const actual=await original<any>();return {...actual,
  parseDeploymentPackageInventory(input:any){if(input?.r1172OSLeaf===true&&input.packageHash==='a'.repeat(64)){const value={packageHash:input.packageHash};leaf.inventory.add(value);return value;}return actual.parseDeploymentPackageInventory(input);},
  verifyDeploymentPackage(release:string,inventory:object){if(leaf.physicalRoot&&release===leaf.release&&leaf.inventory.has(inventory))return;return actual.verifyDeploymentPackage(release,inventory);},
 };
});
vi.mock('node:child_process',async original=>{const actual=await original<any>();return {...actual,...Object.fromEntries(['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'].map(name=>[name,()=>unexpected('child_process.'+name)]))};});
vi.mock('../../src/runtime/verification/controller-ipc.js',async original=>({...await original<any>(),callControllerIpc(){return unexpected('helperIPC');}}));
vi.mock('../../src/runtime/verification/installation-command.js',async original=>({...await original<any>(),
 assertInstallationCommandIdle(scope:string){if(scope!==join(leaf.base,'state')||!leaf.physicalRoot)throw Error('probe_fixture_os_scope');},
 async runInstallationCommand(input:any){
  const trace={executable:input.executable,argv:Array.isArray(input.argv)?[...input.argv]:input.argv,stdin:input.stdin,step:leaf.cursor,phase:leaf.phase,outcome:'pending'};leaf.commands.push(trace);
  try{
   const expected=leaf.program[leaf.cursor];
   if(!leaf.physicalRoot||input.scope!==join(leaf.base,'state')||input.cwd!==input.scope||input.timeoutMs!==30000||json(input.env)!==json(leaf.env)||typeof input.assertCurrent!=='function')throw Error('probe_fixture_os_context');
   if(Object.keys(input).sort().join(',')!=='argv,assertCurrent,cwd,env,executable,scope,signal,stdin,timeoutMs'||!expected||input.executable!==expected.executable||!Array.isArray(input.argv)||json(input.argv)!==json(expected.argv)||input.stdin!==expected.stdin)throw Error('probe_fixture_os_exact_command:'+leaf.phase+':'+leaf.cursor);
   const current=()=>{input.signal?.throwIfAborted();const result:unknown=Reflect.apply(input.assertCurrent,input,[]);if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error('probe_fixture_os_current');}};
   current();const output=Buffer.from(expected.output);current();
   trace.outcome='ok';leaf.cursor++;if(leaf.repeat&&leaf.cursor===leaf.program.length)leaf.cursor=0;
   return output;
  }catch(error){trace.outcome='rejected';throw error;}
 },
}));
const H='a'.repeat(64),hash=(value:unknown)=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:json(value)).digest('hex');
function assertProgramDone(){if(leaf.repeat?leaf.cursor!==0:leaf.cursor!==leaf.program.length)throw Error('probe_fixture_os_incomplete:'+leaf.phase+':'+leaf.cursor);}
function setProgram(phase:string,program:Command[],repeat=false){if(leaf.program.length)assertProgramDone();leaf.phase=phase;leaf.program=program;leaf.cursor=0;leaf.repeat=repeat;}
function seedOS(database:Database,manifest:InstalledControllerLifetime['manifest'],imageId:string){
 leaf.release=join(leaf.base,'releases',H);const sources={baseImage:{sha256:'e'.repeat(64)},engine:{sha256:'f'.repeat(64)},workerImage:{sha256:imageId.slice(7),imageId}};
 const plan=buildPrivateMacEnginePlan({releaseRoot:leaf.release,stateRoot:join(leaf.base,'state'),baseImageSha256:sources.baseImage.sha256,dockerArchiveSha256:sources.engine.sha256,creationNonce:'c'.repeat(64)});
 leaf.socket=plan.hostSocket;leaf.env=plan.env;
 const binaries=['containerd','containerd-shim-runc-v2','ctr','docker','docker-init','docker-proxy','dockerd','runc'].map(name=>({name,sha256:'f'.repeat(64),size:1}));
 for(const [path,body] of [[join(leaf.base,'deployment.json'),json(manifest)],[join(leaf.base,'releases',H+'.json'),json({r1172OSLeaf:true,packageHash:H})],[join(leaf.release,'runtime-sources.json'),json(sources)],[join(leaf.release,'vm/engine-files.json'),json(binaries)],[plan.configPath,plan.configJson],[join(leaf.base,'state/lima',plan.name,'qemu.pid'),'123'],[join(leaf.base,'state/lima',plan.name,'lima.yaml'),plan.configJson]])leaf.files.set(path,body);
 const journal=createEngineBootstrapJournal(database),proposal={deploymentHash:H,configHash:hash('r1172-normalized'),creationNonce:'c'.repeat(64),vmName:'xiaok-engine' as const};
 const observation={machineId:'1'.repeat(32),bootId:leaf.boot,creationNonce:proposal.creationNonce,effectiveConfigHash:proposal.configHash,processUid:502,processStartIdentity:'r1172-existing-process',engineId:'r1172-existing-engine'};
 const {engineId:unusedEngineId,...vmObservation}=observation;void unusedEngineId;
 journal.prepare(proposal);journal.beginCreate(proposal);journal.recordVm(proposal,vmObservation);
 for(const [name,digest] of [['copy-engine',sources.engine.sha256],['install-engine',hash(plan.bootstrapScript)],['load-worker',sources.workerImage.sha256]] as const){journal.phase(proposal,name,digest);journal.phase(proposal,name,digest,true);}journal.recordObservation(proposal,observation);
 const observer=join(leaf.release,'bin/process-observation'),directory=join(leaf.base,'state/lima',plan.name),docker='/usr/local/lib/xiaok-engine/docker --host unix:///run/xiaok-engine/docker.sock';
 const step=(executable:string,argv:readonly string[],stdin:string,output:string):Command=>({executable,argv,stdin,output});
 const shell=(stdin:string,output:string)=>step(plan.executable,['shell',plan.name,'sudo','-n','/bin/sh','-s'],stdin,output);
 const process=step(observer,['123'],'',json({uid:502,realUid:502,executable:join(leaf.release,'bin/qemu-system-aarch64'),startIdentity:observation.processStartIdentity}));
 const validate=step(plan.executable,['validate','--fill',plan.configPath],'','r1172-normalized'),lima=step(plan.executable,['validate','--fill',join(directory,'lima.yaml')],'','r1172-normalized');
 const ids=shell('set -eu\ncat /etc/machine-id\ncat /proc/sys/kernel/random/boot_id\ncat /etc/xiaok-controller-creation-nonce\n',observation.machineId+'\n'+observation.bootId+'\n'+observation.creationNonce+'\n');
 const info=shell(`${docker} info --format '{{json .}}'\n`,json({ID:observation.engineId,OSType:'linux',Architecture:'aarch64',Driver:'overlay2',DriverStatus:[]}));
 const binary=shell(ENGINE_BINARY_CENSUS_SCRIPT,binaries.map(x=>`${x.name} ${x.sha256} 0 0 755 1 ${x.size}`).join('\n')+'\n');
 const vm=[process,lima,ids,process],observe=[...vm,info];
 const archive=shell(`set -eu\nif [ ! -e '/home/xiaokvm/docker.tgz' ] && [ ! -L '/home/xiaokvm/docker.tgz' ]; then printf missing; else [ ! -L '/home/xiaokvm/docker.tgz' ] && [ -f '/home/xiaokvm/docker.tgz' ]; printf '%s  %s\\n' '${sources.engine.sha256}' '/home/xiaokvm/docker.tgz' | sha256sum -c - >/dev/null; printf complete; fi\n`,'complete');
 const unit=shell(`set -eu\nif [ ! -e /etc/systemd/system/xiaok-engine.service ]; then printf missing; else [ ! -L /etc/systemd/system/xiaok-engine.service ]; printf '%s  %s\\n' '${hash(plan.unit)}' '/etc/systemd/system/xiaok-engine.service' | sha256sum -c - >/dev/null; if systemctl is-active --quiet xiaok-engine.service; then printf complete; else printf missing; fi; fi\n`,'complete');
 const image=shell(`set -eu\nif ${docker} image inspect '${sources.workerImage.imageId}' >/dev/null 2>&1; then ${docker} image inspect '${sources.workerImage.imageId}' --format '{{.Id}}'; else printf missing; fi\n`,imageId+'\n');
 const normal=[validate,...vm,archive,...vm,archive,unit,binary,...vm,unit,binary,info,image,...vm,info,image,...observe,...vm];
 const maintenance=[validate,process,lima,ids,info,shell(`set -eu\n[ ! -L /etc/systemd/system/xiaok-engine.service ]\nprintf '%s  %s\\n' '${hash(plan.unit)}' '/etc/systemd/system/xiaok-engine.service' | sha256sum -c - >/dev/null\nsystemctl is-active --quiet xiaok-engine.service\n`,''),binary,shell(`${docker} image inspect '${sources.workerImage.imageId}' --format '{{.Id}}'\n`,imageId+'\n'),process];
 return {normal,observe,maintenance,observation};
}
function required<T>(value:T|undefined,reason:string):T{if(value===undefined)throw Error(reason);return value;}
function createdContainerId(value:unknown):string{
 if(!value||typeof value!=='object'||!('Id' in value)||typeof value.Id!=='string')throw Error('probe_fixture_create_identity');
 return value.Id;
}
function assertOriginalFailure(error:unknown,mode:ProbeMode,cut:Error,pause:Error):void{
 if(mode==='terminal'||mode==='missing-record'){
  if(error!==pause)throw Error('probe_fixture_terminal_pause_not_preserved');
  return;
 }
 if(!(error instanceof AggregateError)||error.message!==cut.message+': qualification_retirement_failed'||error.cause!==cut||error.errors.length!==2||error.errors[0]!==cut||error.errors[1]!==pause)throw Error('probe_fixture_cut_and_pause_not_preserved');
}
function readProbe(db:Database):ProbeRecord|undefined{
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='verification_engine_qualification'").get())return;
 const rows=db.prepare<[],{id:number;record_json:string}>('SELECT id,record_json FROM verification_engine_qualification').all();if(!rows.length)return;
 if(rows.length!==1||rows[0].id!==1)throw Error('probe_fixture_record_population');return JSON.parse(rows[0].record_json) as ProbeRecord;
}
function sourceTransport(record:()=>ProbeRecord|undefined){
 const containers=new Map<string,any>();let serial=0;
 return {
  async create(body:ProbeRecord['body']){const r=record();if(!r||json(body)!==json(r.body))throw Error('probe_fixture_source_body');const Id=(++serial).toString(16).padStart(64,'0');containers.set(Id,{Id,Image:body.Image,Config:structuredClone(body),HostConfig:structuredClone(body.HostConfig),NetworkSettings:{SandboxID:'',SandboxKey:'',Ports:{},Networks:{none:{IPAMConfig:null,Links:null,Aliases:null,DriverOpts:null,GwPriority:0,NetworkID:'a'.repeat(64),EndpointID:'',Gateway:'',IPAddress:'',MacAddress:'',IPPrefixLen:0,IPv6Gateway:'',GlobalIPv6Address:'',GlobalIPv6PrefixLen:0,DNSNames:null}}},State:{Running:false,Pid:0,Status:'created',ExitCode:0}});return {Id};},
  async inspect(id:string){const found=containers.get(id);if(!found)throw Error('docker_engine_http_404');return structuredClone(found);},
  async start(id:string){const found=containers.get(id);if(!found)throw Error('probe_fixture_source_missing');Object.assign(found.State,{Running:true,Pid:1,Status:'running'});Object.assign(found.NetworkSettings,{SandboxID:'source-only-running',SandboxKey:'source-only-sandbox'});found.NetworkSettings.Networks.none.EndpointID='source-only-running-endpoint';},
  async wait(id:string){const found=containers.get(id);if(!found)throw Error('probe_fixture_source_missing');Object.assign(found.State,{Running:false,Pid:0,Status:'exited'});Object.assign(found.NetworkSettings,{SandboxID:'',SandboxKey:''});found.NetworkSettings.Networks.none.EndpointID='';return {StatusCode:0};},
  async logs(id:string){if(!containers.has(id))throw Error('probe_fixture_source_missing');const r=record();if(!r)throw Error('probe_fixture_source_record');return r.challenge;},
  async isContainerAbsent(id:string){return !containers.has(id);},async remove(id:string){containers.delete(id);},
 };
}
async function installedProbeFixtureImplementation(options:{mode:ProbeMode|'running-cleanup';imageId:string;socketPath?:string;sourceOnly?:true}){
 if(options.mode==='running-cleanup'&&Object.hasOwn(options,'sourceOnly'))throw Error('running_cleanup_requires_real_transport');
 if(leaf.physicalRoot)throw Error('probe_fixture_previous_owner_active');
 if(!/^sha256:[a-f0-9]{64}$/.test(options.imageId)||!options.sourceOnly&&!options.socketPath)throw Error('probe_fixture_explicit_endpoint');
 const root=realpathSync(mkdtempSync(join(tmpdir(),'maintenance-probe-owner-'))),physicalState=join(root,'state');
 for(const directory of [physicalState,join(root,'migrations'),join(root,'public')])mkdirSync(directory);
 leaf.physicalRoot=root;leaf.physicalDB=join(physicalState,'authority.sqlite');leaf.projectionActive=false;leaf.markerCalls=0;leaf.rootStarted=false;leaf.files.clear();leaf.commands=[];leaf.forbidden=[];leaf.program=[];leaf.cursor=0;leaf.phase='preparation';leaf.dockerSocket=options.socketPath;
 const keys=generateKeyPairSync('ed25519'),receiverKeys=generateKeyPairSync('ed25519');
 const manifest={version:2 as const,authorityId:'authority',publicKeyPem:keys.publicKey.export({format:'pem',type:'spki'}).toString(),packageHash:H,serviceUid:502,allowedUserIds:[501]};
 writeFileSync(join(root,'deployment.json'),json(manifest));writeFileSync(join(root,'receiver.json'),json({version:1,receiverId:'receiver',receiverInstanceEpoch:1,keyId:hash(receiverKeys.publicKey.export({format:'der',type:'spki'})),publicKeyPem:receiverKeys.publicKey.export({format:'pem',type:'spki'}).toString(),serviceUid:503}));
 const counters={initializer:0,qualificationFactory:0,transaction:0,beginDispatch:0,bindContainer:0,create:0,start:0,wait:0,logs:0,remove:0,maintenanceCreate:0,maintenanceStart:0,metadataGuards:0,migrationGuards:0,persist:0,engineIdDriftRejections:0,maintenanceMetadataGuards:0};
 let phase:'normal'|'maintenance'|'closing'='normal',record:ProbeRecord|undefined,engine:Awaited<ReturnType<typeof installedEngine.initializeInstalledMacEngine>>|undefined;
 let actualQualification:ReturnType<typeof qualificationModule.createInstalledEngineQualification>|undefined;
 let originalDatabase:Database|undefined,normalLifetime:InstalledControllerLifetime|undefined;
 let sharedOwner:ReturnType<typeof shared.createInstalledSharedCapacity>|undefined,maintenanceOwner:ReturnType<typeof shared.createInstalledSharedCapacity>|undefined;
 let originalOpaque:object|undefined;
 const originalIds=new Set<string>(),cut=Error('probe_fixture_original_safe_cut:'+options.mode),pause=Error('probe_fixture_after_actual_probe_request');
 let requestObserved=false,terminalInspectorObserved=false,originalState:string|undefined,normalFailure:unknown;
 const running=options.mode==='running-cleanup',events:RunningEvent[]=[];
 let callSerial=0,activeAbsence:number|undefined,cutUsed=false,recordIdentity:string|undefined;
 let ackObserved=false,released=false,deleted=false,terminalCommitted=false,drainObserved=false,databaseClosed=false;
 const auditPath=join(root,'running-cleanup-audit.json');
 function event(method:string,stage:RunningEvent['stage'],call:number,value?:unknown,containerId?:string,parentAbsence?:number){events.push({sequence:events.length,method,stage,call,containerId,parentAbsence,value});}
 function originalTarget(id:unknown){
  const db=required(originalDatabase,'running_cleanup_database'),found=readProbe(db);
  if(phase!=='normal'||!found||!capture(found.expected))throw Error('running_cleanup_original_record');
  const identity=json({expected:found.expected,body:found.body,allocation:found.allocation,engineHash:found.engineHash,challenge:found.challenge});
  if(recordIdentity===undefined)recordIdentity=identity;else if(identity!==recordIdentity)throw Error('running_cleanup_record_changed');
  const rows=db.prepare<[],{execution_id:string;state:string;container_id:string|null}>('SELECT execution_id,state,container_id FROM execution_attempts').all();
  if(rows.length!==1||rows[0].execution_id!==found.expected.executionIdentity)throw Error('running_cleanup_attempt_population');
  if(id!==undefined&&(typeof id!=='string'||originalIds.size!==1||!originalIds.has(id)||rows[0].container_id!==id))throw Error('running_cleanup_foreign_container');
  return {found,row:rows[0]};
 }
 function saveAudit(status:RunningCleanupStatus,errors:readonly unknown[]=[]){
  const audit={status,root,auditPath,containerIds:[...originalIds],socketPath:options.socketPath,imageId:options.imageId,
   scope:'dedicated devDocker normal-owner cleanup; not qualification or native evidence',events:events.slice(),
   facts:{cutUsed,requestObserved,ackObserved,released,deleted,terminalCommitted,drainObserved,databaseClosed,
    startupRejectedWithCut:normalFailure===cut,databaseOpen:originalDatabase?.open,unresolved:normalFailure!==undefined&&isInstalledControllerShutdownUnresolved(normalFailure),
    counters:{...counters},forbiddenEffects:leaf.forbidden.slice()},primary:errorEvidence(normalFailure),errors:errors.map(value=>errorEvidence(value))};
  writeFileSync(auditPath,JSON.stringify(audit,null,2)+'\n',{flag:'wx',mode:0o600});return audit;
 }
 const spies:{mockRestore():void}[]=[];
 let unstartedLifetime:InstalledControllerLifetime|undefined,joinNormal:(()=>Promise<void>)|undefined,joinMaintenance:(()=>Promise<void>)|undefined;
 let openingDatabase=false;const ownedDatabases:Database[]=[];
 function openLifetime(logical:boolean){
  leaf.projectionActive=false;
  openingDatabase=true;const database=openPrivateVerificationDatabase(physicalState);ownedDatabases.push(database);openingDatabase=false;
  const files=database.pragma('database_list') as {name:string;file:string}[];
  if(database.name!==leaf.physicalDB||files.length!==1||files[0].name!=='main'||files[0].file!==leaf.physicalDB)throw Error('probe_fixture_native_db_not_physical');
  leaf.projectionActive=true;
  let closed=false;const lifetime:InstalledControllerLifetime=Object.freeze({base:logical?leaf.base:root,state:logical?join(leaf.base,'state'):physicalState,release:logical?leaf.release:join(root,'releases',H),manifest,database,...keys,serviceEpoch:randomUUID(),peerHelper:join(root,'never-executed-peer-helper'),
   assertCurrent(){if(closed||!database.open)throw Error('probe_fixture_lifetime_closed');},close(){if(closed)return;database.close();closed=true;if(running){databaseClosed=!database.open;event('database.close','end',++callSerial,{open:database.open});}},
  });leaf.lifetimes.add(lifetime);leaf.next=lifetime;unstartedLifetime=lifetime;return lifetime;
 }
 function capture(expected:QuiescenceExpectation){
  if(!originalDatabase?.open)return false;const found=readProbe(originalDatabase);
  if(!found||json(found.expected)!==json(expected))return false;
  const rows=originalDatabase.prepare<[],{execution_id:string;state:string}>('SELECT execution_id,state FROM execution_attempts').all();
  if(rows.length!==1||rows[0].execution_id!==expected.executionIdentity||expected.sessionIdentity!=='private-engine-qualification')throw Error('probe_fixture_original_attempt_population');
  record=found;originalState=rows[0].state;return true;
 }
 try{
  normalLifetime=openLifetime(false);originalDatabase=normalLifetime.database;
  const fixedPrograms=seedOS(originalDatabase,manifest,options.imageId);
  const lifetime=normalLifetime;createInstalledProfileIndexPublisher({lifetime});counters.migrationGuards++;
  const actualMetadata=metadata.createInstalledControllerMetadataSource;
  spies.push(vi.spyOn(metadata,'createInstalledControllerMetadataSource').mockImplementation(value=>{const result=actualMetadata(value);if(phase==='normal'&&value===lifetime)counters.metadataGuards++;else if(phase==='maintenance'&&value===leaf.next)counters.maintenanceMetadataGuards++;return result;}));
  const actualShared=shared.createInstalledSharedCapacity;
  spies.push(vi.spyOn(shared,'createInstalledSharedCapacity').mockImplementation(authority=>{const owner=actualShared(authority);if(phase==='normal')sharedOwner=owner;else if(phase==='maintenance')maintenanceOwner=owner;return owner;}));
  const actualTransaction=qualificationModule.executeQualificationTransactionCommand;
  spies.push(vi.spyOn(qualificationModule,'executeQualificationTransactionCommand').mockImplementation((command,context)=>{const result=actualTransaction(command,context);if(result&&phase==='normal')counters.transaction++;return result;}));
  const actualFactory=qualificationModule.createInstalledEngineQualification;
  spies.push(vi.spyOn(qualificationModule,'createInstalledEngineQualification').mockImplementation(input=>{const result=actualFactory(input);if(input.database!==originalDatabase||actualQualification)throw Error('probe_fixture_extra_qualification');actualQualification=result;counters.qualificationFactory++;return result;}));
  const actualInitializer=installedEngine.initializeInstalledMacEngine;
  spies.push(vi.spyOn(installedEngine,'initializeInstalledMacEngine').mockImplementation(async input=>{
   if(input.database!==originalDatabase||phase!=='normal'||counters.initializer++)throw Error('probe_fixture_extra_initializer');
   const platform=Object.getOwnPropertyDescriptor(process,'platform')!,arch=Object.getOwnPropertyDescriptor(process,'arch')!;setProgram('initialize',fixedPrograms.normal);
   let building:ReturnType<typeof actualInitializer>;
   try{Object.defineProperty(process,'platform',{value:'darwin'});Object.defineProperty(process,'arch',{value:'arm64'});building=actualInitializer(input);}finally{Object.defineProperty(process,'platform',platform);Object.defineProperty(process,'arch',arch);}
   const result=await building;assertProgramDone();engine=result;return result;
  }));
  const actualInspector=installedEngine.inspectInstalledMacEngineHandle;
  let inspections=0;
  spies.push(vi.spyOn(installedEngine,'inspectInstalledMacEngineHandle').mockImplementation(async handle=>{
   if(handle!==engine)return actualInspector(handle);
   if(options.sourceOnly&&inspections===0){
    // Only a declared OS info response changes; the real private inspector must
    // reject this actual value drift before the original unchanged census runs.
    const drift=fixedPrograms.observe.map((command,index)=>index===4?{...command,output:json({...JSON.parse(command.output),ID:fixedPrograms.observation.engineId+'-drift'})}:command);
    setProgram('inspect-negative-engine-id',drift);let rejected=false;
    try{await actualInspector(handle);}catch(error){if(!(error instanceof Error)||error.message!=='installed_engine_changed')throw error;rejected=true;}
    assertProgramDone();if(!rejected)throw Error('probe_fixture_engine_id_drift_not_rejected');counters.engineIdDriftRejections++;
   }
   setProgram('inspect',fixedPrograms.observe);await actualInspector(handle);assertProgramDone();inspections++;
   const found=originalDatabase?.open?readProbe(originalDatabase):undefined;
   if((options.mode==='terminal'||options.mode==='missing-record')&&inspections===2&&found&&capture(found.expected)&&originalState==='terminal'&&counters.logs===1)terminalInspectorObserved=true;
   // Return actual success to the producer: only it may grant terminal-ready.
   // The intended terminal interruption is actual retire persist's committed pause.
  }));
  const begin=ExecutionJournal.prototype.beginDispatch,bind=ExecutionJournal.prototype.bindContainer;
  spies.push(vi.spyOn(ExecutionJournal.prototype,'beginDispatch').mockImplementation(function(this:ExecutionJournal,expected){
   if(phase==='normal'&&capture(expected)){if(options.mode==='prepared'){if(originalState!=='prepared')throw Error('probe_fixture_prepared_cut_state');throw cut;}counters.beginDispatch++;}
   return begin.call(this,expected);
  }));
  spies.push(vi.spyOn(ExecutionJournal.prototype,'bindContainer').mockImplementation(function(this:ExecutionJournal,expected,id){
   bind.call(this,expected,id);if(phase==='normal'&&capture(expected)){counters.bindContainer++;if(options.mode==='created'){if(originalState!=='created'||counters.start)throw Error('probe_fixture_created_cut_state');throw cut;}}
  }));
  if(running){
   const terminal=ExecutionJournal.prototype.recordPhysicalTerminal,readFailed=stack.readInstalledFailedStackDrain;
   spies.push(vi.spyOn(ExecutionJournal.prototype,'recordPhysicalTerminal').mockImplementation(function(this:ExecutionJournal,expected,id,exitCode){
    terminal.call(this,expected,id,exitCode);
    const {found,row}=originalTarget(id);
    if(json(expected)!==json(found.expected)||row.state!=='terminal'||terminalCommitted)throw Error('running_cleanup_terminal_commit');
    terminalCommitted=true;event('journal.recordPhysicalTerminal','end',++callSerial,{state:row.state,exitCode},id);
   }));
   spies.push(vi.spyOn(stack,'readInstalledFailedStackDrain').mockImplementation((error,assembly,value)=>{
    const witness=readFailed(error,assembly,value);
    drainObserved=error===cut&&witness===cut&&value===normalLifetime;
    event('readInstalledFailedStackDrain','end',++callSerial,{sameError:error===cut,sameLifetime:value===normalLifetime,returnedOriginalError:witness===cut});
    return witness;
   }));
  }
  const persist=handoff.persistInstalledMaintenanceRequest;
  spies.push(vi.spyOn(handoff,'persistInstalledMaintenanceRequest').mockImplementation(command=>{
   const completion=persist(command);if(phase!=='normal')return completion;
   if(running){
    const facts=qualificationModule.inspectQualificationCleanupHandoffCommand(command);
    if(!facts||facts.source!==actualQualification||facts.database!==originalDatabase||!normalLifetime)throw Error('running_cleanup_command_owner');
    const {found}=originalTarget([...originalIds][0]);
    if(facts.kind!=='probe'||facts.resourceId!==found.expected.executionIdentity||json(facts.expected)!==json(found.expected)||json(facts.allocations)!==json([found.allocation]))throw Error('running_cleanup_command_target');
    const db=facts.database;
    if(db.inTransaction)throw Error('running_cleanup_uncommitted_handoff');
    const rows=db.prepare<[string,string],{phase:string;claim_epoch:string|null;item_id:string;target_json:string;target_hash:string;outcome:string;evidence_hash:string|null}>(`SELECT h.phase,h.claim_epoch,i.item_id,i.target_json,i.target_hash,i.outcome,i.evidence_hash FROM verification_maintenance_handoffs h JOIN verification_maintenance_handoff_items i USING(authority_id,origin_epoch) WHERE authority_id=? AND origin_epoch=?`).all(manifest.authorityId,normalLifetime.serviceEpoch);
    if(rows.length!==1)throw Error('running_cleanup_handoff_population');
    const row=rows[0],target=JSON.parse(row.target_json);
    if(row.phase!=='requested'||row.claim_epoch!==null||target.kind!=='probe'||target.resourceId!==facts.resourceId||json(target.expected)!==json(found.expected)||json(target.allocations)!==json([found.allocation])||row.item_id!==hash({kind:'probe',resourceId:facts.resourceId})||row.target_hash!==hash(target))throw Error('running_cleanup_handoff_identity');
    const state=required(sharedOwner,'running_cleanup_capacity_owner').budget.getState(found.allocation);
    if(facts.action==='request'){
     handoff.assertInstalledMaintenanceRequestRecorded(command);
     if(requestObserved||row.outcome!=='requested'||row.evidence_hash!==null||state!=='reserved'||found.deleted)throw Error('running_cleanup_request');
     requestObserved=true;
    }else{
     if(!requestObserved||ackObserved||row.outcome!=='completed'||!row.evidence_hash||state!=='released'||!found.deleted)throw Error('running_cleanup_ack');
     ackObserved=true;released=true;deleted=true;
    }
    counters.persist++;event('persist.'+facts.action,'end',++callSerial,{row,budgetState:state,deleted:found.deleted});return completion;
   }
   const assertRecorded=Reflect.get(handoff,'assertInstalledMaintenanceRequestRecorded');
   if(typeof assertRecorded!=='function')throw Error('probe_fixture_recorded_assert_unavailable');
   assertRecorded(command); // Actual private inspector, same opaque command, no mint/copy.
   if(!record||!originalDatabase?.open||!normalLifetime||originalDatabase.inTransaction)throw Error('probe_fixture_request_without_original');
   const row=originalDatabase.prepare<[string,string],{phase:string;claim_epoch:string|null;item_id:string;target_json:string;target_hash:string;outcome:string;evidence_hash:string|null}>(`SELECT h.phase,h.claim_epoch,i.item_id,i.target_json,i.target_hash,i.outcome,i.evidence_hash FROM verification_maintenance_handoffs h JOIN verification_maintenance_handoff_items i USING(authority_id,origin_epoch) WHERE authority_id=? AND origin_epoch=?`).all(manifest.authorityId,normalLifetime.serviceEpoch);
   if(row.length!==1)throw Error('probe_fixture_request_population');const r=row[0],target=JSON.parse(r.target_json);
   if(r.phase!=='requested'||r.claim_epoch!==null||r.outcome!=='requested'||r.evidence_hash!==null||target.kind!=='probe'||target.resourceId!==record.expected.executionIdentity||json(target.expected)!==json(record.expected)||json(target.allocations)!==json([record.allocation])||r.item_id!==hash({kind:'probe',resourceId:record.expected.executionIdentity})||r.target_hash!==hash(target))throw Error('probe_fixture_exact_original_request');
   if((options.mode==='terminal'||options.mode==='missing-record')&&!terminalInspectorObserved)throw Error('probe_fixture_terminal_inspector_not_completed');
   requestObserved=true;originalOpaque=command;counters.persist++;throw pause;
  }));
  const docker=options.sourceOnly?sourceTransport(()=>record??(originalDatabase?.open?readProbe(originalDatabase):undefined)):new (await vi.importActual<typeof import('../../src/runtime/isolated-execution/docker-engine-transport.js')>('../../src/runtime/isolated-execution/docker-engine-transport.js')).DockerEngineTransport({socketPath:options.socketPath!});
  const transport=docker as unknown as Record<string,any>;
  for(const name of ['create','start','wait','logs','inspect','remove','isContainerAbsent',...(running?['kill']:[])]){
   const actual=transport[name];if(typeof actual!=='function')throw Error('probe_fixture_transport_method');
   Object.defineProperty(transport,name,{configurable:true,value:async(...args:any[])=>{
    if(phase==='maintenance'&&(name==='create'||name==='start')){if(name==='create')counters.maintenanceCreate++;else counters.maintenanceStart++;return unexpected('maintenance.'+name);}
    if(name in counters)(counters as any)[name]++;
    if(running){
     const call=++callSerial,parentAbsence=activeAbsence;
     const {found,row}=originalTarget(name==='create'?undefined:args[0]);
     if(name==='create'&&(originalIds.size!==0||counters.create!==1||row.container_id!==null||json(args[0])!==json(found.body)))throw Error('running_cleanup_extra_or_changed_create');
     if(name==='start'&&counters.start!==1)throw Error('running_cleanup_extra_start');
     const id=name==='create'?undefined:createdContainerId({Id:args[0]});
     event(name,'begin',call,undefined,id,parentAbsence);
     if(name==='wait'&&!cutUsed){
      const budgetState=required(sharedOwner,'running_cleanup_capacity_owner').budget.getState(found.allocation);
      if(counters.wait!==1||row.state!=='running'||counters.start!==1||budgetState!=='reserved')throw Error('running_cleanup_cut_not_running_reserved');
      cutUsed=true;event(name,'cut',call,{journal:row,allocation:found.allocation,budgetState},id);throw cut;
     }
     if(name==='isContainerAbsent')activeAbsence=call;
     try{
      const result:unknown=await Reflect.apply(actual,transport,args);
      if(name==='create')originalIds.add(createdContainerId(result));
      event(name,'end',call,structuredClone(result),name==='create'?createdContainerId(result):id,parentAbsence);
      return result;
     }catch(error){event(name,'error',call,errorEvidence(error),id,parentAbsence);throw error;}
     finally{if(name==='isContainerAbsent')activeAbsence=parentAbsence;}
    }
    const result:unknown=await Reflect.apply(actual,transport,args);if(name==='create')originalIds.add(createdContainerId(result));return result;
   }});
  }
  for(const name of ['createMounted','createVolume','populateInputFile','readInputArchive','attachOutput','recoverAttempt',...(!running?['kill']:[]),'isVolumeAbsent','removeVolume','findMountedAttempt','inspectVolume'])Object.defineProperty(transport,name,{configurable:true,value:()=>unexpected('docker.'+name)});
  leaf.transport=transport;
  leaf.rootStarted=true;const startup=startInstalledVerificationController();unstartedLifetime=undefined;void startup.catch(()=>{});
  joinNormal=async()=>{const settled=await Promise.allSettled([startup]);if(settled[0].status==='fulfilled')await settled[0].value.close();};
  const result=await Promise.allSettled([startup]);
  if(result[0].status!=='rejected')throw Error('probe_fixture_unexpected_qualification_issued');normalFailure=result[0].reason;
  if(options.mode==='running-cleanup'){
   const errors:unknown[]=[];
   if(normalFailure!==cut||normalFailure instanceof AggregateError||isInstalledControllerShutdownUnresolved(normalFailure))errors.push(normalFailure);
   if(!cutUsed||!requestObserved||!ackObserved||!released||!deleted||!terminalCommitted||!drainObserved||!databaseClosed||originalDatabase.open||!sharedOwner||!engine||!actualQualification||originalIds.size!==1||counters.initializer!==1||counters.qualificationFactory!==1||counters.transaction!==1||counters.beginDispatch!==1||counters.bindContainer!==1||counters.create!==1||counters.start!==1||counters.logs!==0||counters.remove!==1||counters.persist!==2||counters.maintenanceCreate!==0||counters.maintenanceStart!==0||leaf.forbidden.length)errors.push(Error('running_cleanup_incomplete_owned_drain'));
   const ends=(method:string)=>events.filter(item=>item.method===method&&item.stage==='end');
   const kills=events.filter(item=>item.method==='kill'&&item.stage==='begin'),kill=kills[0];
   const direct=ends('inspect').filter(item=>item.parentAbsence===undefined);
   const prekill=kill?direct.find(item=>item.sequence===kill.sequence-1):direct[0];
   const state=property(prekill?.value,'State'),network=property(prekill?.value,'NetworkSettings');
   const lifecycle=[property(network,'SandboxID'),property(network,'SandboxKey'),property(property(property(network,'Networks'),'none'),'EndpointID')];
   const exposed=property(state,'Running')===true&&typeof property(state,'Pid')==='number'&&Number(property(state,'Pid'))>0&&property(state,'Status')==='running'&&lifecycle.some(value=>typeof value==='string'&&value.length>0);
   const beforeInspect=prekill?events[prekill.sequence-2]:undefined;
   const adjacent=beforeInspect?.method==='isContainerAbsent'&&beforeInspect.stage==='end'&&beforeInspect.value===false&&events[prekill!.sequence-1]?.method==='inspect'&&events[prekill!.sequence-1]?.stage==='begin';
   const terminal=direct.find(item=>property(property(item.value,'State'),'Status')==='exited'&&property(property(item.value,'State'),'Running')===false&&property(property(item.value,'State'),'Pid')===0);
   const removed=ends('remove')[0],absent=ends('isContainerAbsent').find(item=>item.value===true);
   const absent404=absent&&events.some(item=>item.method==='inspect'&&item.stage==='error'&&item.parentAbsence===absent.call&&property(item.value,'message')==='docker_engine_http_404');
   const terminalCommit=ends('journal.recordPhysicalTerminal')[0],request=ends('persist.request')[0],ack=ends('persist.ack')[0],drain=ends('readInstalledFailedStackDrain')[0],closed=ends('database.close')[0];
   const wait=ends('wait')[0],started=ends('start')[0],injected=events.find(item=>item.method==='wait'&&item.stage==='cut');
   if(!started||!injected||!request||!(started.sequence<injected.sequence&&injected.sequence<request.sequence))errors.push(Error('running_cleanup_start_cut_request_order'));
   if(!terminal||!terminalCommit||!removed||!absent||!absent404||!request||!ack||!drain||!closed||!(request.sequence<terminal.sequence&&terminal.sequence<terminalCommit.sequence&&terminalCommit.sequence<removed.sequence&&removed.sequence<absent.sequence&&absent.sequence<ack.sequence&&ack.sequence<drain.sequence&&drain.sequence<closed.sequence))errors.push(Error('running_cleanup_physical_ack_order'));
   if(events.some(item=>item.stage==='error'&&!(item.method==='inspect'&&item.parentAbsence!==undefined&&property(item.value,'message')==='docker_engine_http_404')))errors.push(Error('running_cleanup_transport_error'));
   if(kills.length>1||ends('kill').length!==kills.length||ends('wait').length!==kills.length||counters.wait!==1+kills.length||kill&&(!wait||!terminal||!(kill.sequence<ends('kill')[0].sequence&&ends('kill')[0].sequence<wait.sequence&&wait.sequence<terminal.sequence)))errors.push(Error('running_cleanup_kill_wait_order'));
   assertProgramDone();
   for(const spy of spies.splice(0).reverse())try{spy.mockRestore();}catch(error){errors.push(error);}
   const status:RunningCleanupStatus=errors.length?'FAIL_PRIMARY_OR_CLEANUP_UNKNOWN':!kill&&property(state,'Status')==='exited'?'NOT_PROVEN_ALREADY_TERMINAL':!kill||!exposed||!adjacent?'NOT_PROVEN_A1_NOT_EXPOSED':'PASS';
   const audit=saveAudit(status,errors);
   // Retain the real root and audit. No test-side physical fallback earns PASS.
   // Only the fully drained, observed path relinquishes this fixture's leaf.
   if(status==='PASS'){leaf.projectionActive=false;leaf.physicalRoot=undefined;leaf.files.clear();leaf.transport=undefined;leaf.next=undefined;leaf.program=[];}
   return {kind:'running-cleanup' as const,audit};
  }
  try{assertOriginalFailure(normalFailure,options.mode,cut,pause);}catch(check){throw new AggregateError([normalFailure,check],'probe_fixture_original_cut_not_preserved:'+root);}
  if(!requestObserved)throw new AggregateError([normalFailure],'probe_fixture_actual_probe_request_missing:'+root);
  if(isInstalledControllerShutdownUnresolved(normalFailure)||originalDatabase.open)throw new AggregateError([normalFailure],'probe_fixture_normal_owner_not_closed:'+root);
  const producedRecord=required<ProbeRecord>(record,'probe_fixture_record_missing');
  required<ReturnType<typeof shared.createInstalledSharedCapacity>>(sharedOwner,'probe_fixture_original_owner_missing');
  const producedEngine=required<Awaited<ReturnType<typeof installedEngine.initializeInstalledMacEngine>>>(engine,'probe_fixture_engine_missing');
  const producedQualification=required<ReturnType<typeof qualificationModule.createInstalledEngineQualification>>(actualQualification,'probe_fixture_qualification_missing');
  const producedState=required<string>(originalState,'probe_fixture_original_state_missing');
  if(counters.transaction!==1||counters.metadataGuards!==0||counters.migrationGuards!==1||leaf.markerCalls!==1||counters.engineIdDriftRejections!==(options.sourceOnly?1:0)||counters.qualificationFactory!==1||producedState!==(options.mode==='prepared'?'prepared':options.mode==='created'?'created':'terminal')||leaf.forbidden.length)throw Error('probe_fixture_producer_population:'+JSON.stringify({counters,markerCalls:leaf.markerCalls,producedState,mode:options.mode,forbidden:leaf.forbidden}));
  const made=options.mode==='prepared'?0:1,ran=options.mode==='prepared'||options.mode==='created'?0:1;
  if(counters.initializer!==1||counters.create!==made||counters.bindContainer!==made||counters.beginDispatch!==made||counters.start!==ran||counters.wait!==ran||counters.logs!==ran||originalIds.size!==made)throw Error('probe_fixture_original_effect_population');
  assertProgramDone();leaf.projectionActive=false;
  const original={expected:producedRecord.expected,allocation:producedRecord.allocation,state:producedState,normalFailure,requestObserved,record:structuredClone(producedRecord),engineHandle:producedEngine,qualification:producedQualification};
  phase='maintenance';const maintenanceLifetime=openLifetime(true),db=maintenanceLifetime.database;
  if(json(readExistingEngineBootstrap(db).observation)!==json(fixedPrograms.observation))throw Error('probe_fixture_bootstrap_changed');
  setProgram('maintenance',fixedPrograms.maintenance,true);
  let release!:()=>void,entered!:(value:Awaited<ReturnType<typeof stack.createInstalledMaintenanceStack>>)=>void,rejectEntered!:(error:unknown)=>void;
  const barrier=new Promise<void>(yes=>{release=yes;}),ready=new Promise<Awaited<ReturnType<typeof stack.createInstalledMaintenanceStack>>>((yes,no)=>{entered=yes;rejectEntered=no;});void ready.catch(()=>{});
  const build=stack.createInstalledMaintenanceStack;
  let builderCalls=0;
  const builder=vi.spyOn(stack,'createInstalledMaintenanceStack').mockImplementation(async input=>{
   try{
    if(++builderCalls!==1||input.lifetime!==maintenanceLifetime)throw Error('probe_fixture_extra_maintenance_builder');
    const platform=Object.getOwnPropertyDescriptor(process,'platform')!,arch=Object.getOwnPropertyDescriptor(process,'arch')!;let work:ReturnType<typeof build>;
    try{Object.defineProperty(process,'platform',{value:'darwin'});Object.defineProperty(process,'arch',{value:'arm64'});work=build(input);}finally{Object.defineProperty(process,'platform',platform);Object.defineProperty(process,'arch',arch);}
    const owner=await work;entered(owner);await barrier;return owner;
   }catch(error){rejectEntered(error);throw error;}
  });
  leaf.rootStarted=true;const maintenanceStartup=startInstalledVerificationController();unstartedLifetime=undefined;void maintenanceStartup.catch(()=>{});
  let joining:Promise<void>|undefined,closing:Promise<void>|undefined,missingRecordDeleted=false;
  function finish(){return joining??=(async()=>{release();try{const installed=await maintenanceStartup;await installed.close();}catch(error){
   if(!missingRecordDeleted||!(error instanceof Error)||error instanceof AggregateError||error.message!=='maintenance_probe_unknown'||error.cause!==undefined||db.open||isInstalledControllerShutdownUnresolved(error))throw error;
  }finally{builder.mockRestore();}if(db.open)throw Error('probe_fixture_maintenance_database_open');assertProgramDone();leaf.projectionActive=false;})();}
  joinMaintenance=finish;
  let owner:Awaited<ReturnType<typeof stack.createInstalledMaintenanceStack>>;
  try{owner=await Promise.race([ready,maintenanceStartup.then(()=>{throw Error('probe_fixture_no_active_maintenance');})]);}
  catch(error){release();const joined=await Promise.allSettled([maintenanceStartup]);builder.mockRestore();throw new AggregateError([error,...joined.flatMap(item=>item.status==='rejected'?[item.reason]:[])],'probe_fixture_maintenance_startup:'+root);}
  const activeMaintenanceOwner=required<ReturnType<typeof shared.createInstalledSharedCapacity>>(maintenanceOwner,'probe_fixture_maintenance_owner_missing');
  const maintenanceBudget=activeMaintenanceOwner.budget;
  const {expected,allocation}=producedRecord,id=[...originalIds][0];
  if(options.mode==='prepared'?originalIds.size!==0:originalIds.size!==1)throw Error('probe_fixture_original_container_population');
  if(options.mode==='missing-record'){
   const rows=db.prepare<[],{record_json:string}>('SELECT record_json FROM verification_engine_qualification').all();if(rows.length!==1||json(JSON.parse(rows[0].record_json).expected)!==json(expected))throw Error('probe_fixture_missing_record_target');
   if(db.prepare('DELETE FROM verification_engine_qualification WHERE id=1').run().changes!==1)throw Error('probe_fixture_missing_record_delete');missingRecordDeleted=true;
  }
  async function closeOwned(){
   const errors:unknown[]=[];try{await finish();}catch(error){errors.push(error);}
   if(db.open)errors.push(Error('probe_fixture_retained_owner'));else{
    phase='closing';for(const container of originalIds)try{if(!await transport.isContainerAbsent(container))await transport.remove(container);}catch(error){errors.push(error);}
   }
   for(const spy of spies.reverse())spy.mockRestore();
   if(!errors.length&&options.mode!=='missing-record'){rmSync(root,{recursive:true,force:true});leaf.physicalRoot=undefined;leaf.files.clear();leaf.transport=undefined;leaf.next=undefined;leaf.program=[];}
   else if(!db.open&&!errors.length){leaf.physicalRoot=undefined;leaf.files.clear();leaf.transport=undefined;leaf.next=undefined;leaf.program=[];}
   if(errors.length)throw new AggregateError(errors,'probe_fixture_close:'+root);
  }
  return {kind:'maintenance' as const,fixture:{root,db,engine:transport as unknown as import('../../src/runtime/isolated-execution/docker-engine-transport.js').DockerEngineTransport,budget:maintenanceBudget,maintenance:owner.privateHost.execution,expected,allocation,id,original,counters,
   get forbiddenEffects(){return leaf.forbidden.slice();},
   get commandTrace(){return leaf.commands.map(item=>({...item,argv:Array.isArray(item.argv)?[...item.argv]:item.argv}));},
   replayOriginalRequest(){if(!originalOpaque)throw Error('probe_fixture_original_opaque_missing');return persist(originalOpaque);},
   promises:{normal:startup,maintenance:maintenanceStartup},
   pathIdentity:{physicalDB:leaf.physicalDB,canonicalDB:leaf.canonicalDB,physicalState},finish,close(){return closing??=closeOwned();},
  }};
 }catch(error){
  // A failed/unknown root retains its own DB/lifetime. No forced close or row
  // repair is used to claim safe handoff. Retained path appears in the error.
  const errors:unknown[]=[error];
  const knownPrestart=!joinNormal&&!joinMaintenance&&!leaf.rootStarted;
  try{if(joinMaintenance)await joinMaintenance();else if(unstartedLifetime)unstartedLifetime.close();else if(joinNormal)await joinNormal();}catch(cleanup){if(cleanup!==error)errors.push(cleanup);}
  // Only DB handles created before any actual root invocation belong to this
  // cleanup. A published/unknown startup never becomes a namespace reset.
  if(knownPrestart)for(const database of ownedDatabases)if(database.open)try{database.close();}catch(cleanup){errors.push(cleanup);}
  for(const spy of spies.reverse())try{spy.mockRestore();}catch(cleanup){errors.push(cleanup);}
  if(running)try{saveAudit('FAIL_PRIMARY_OR_CLEANUP_UNKNOWN',errors);}catch(evidence){errors.push(evidence);}
  if(knownPrestart&&errors.length===1&&!running){
   try{
    if(leaf.physicalRoot!==root||openingDatabase||ownedDatabases.some(database=>database.open)||originalIds.size!==0||leaf.fds.size!==0||realpathSync(root)!==root)throw Error('probe_fixture_prestart_cleanup_unknown');
    rmSync(root,{recursive:true,force:false});
    leaf.projectionActive=false;leaf.physicalRoot=undefined;leaf.physicalDB='';leaf.files.clear();leaf.transport=undefined;leaf.next=undefined;leaf.program=[];leaf.cursor=0;leaf.repeat=false;leaf.phase='idle';
   }catch(cleanup){errors.push(cleanup);}
  }
  throw new AggregateError(errors,'probe_fixture_prepare:'+root);
 }
}

export async function installedMaintenanceProbeFixture(options:{mode:ProbeMode;imageId:string;socketPath?:string;sourceOnly?:true}){
 const result=await installedProbeFixtureImplementation(options);
 if(result.kind!=='maintenance')throw Error('probe_fixture_wrong_result');
 return result.fixture;
}
export async function installedProbeRunningCleanupFixture(options:{socketPath:string;imageId:string}){
 if(Object.hasOwn(options,'sourceOnly'))throw Error('running_cleanup_requires_real_transport');
 const result=await installedProbeFixtureImplementation({mode:'running-cleanup',socketPath:options.socketPath,imageId:options.imageId});
 if(result.kind!=='running-cleanup')throw Error('running_cleanup_wrong_result');
 return result.audit;
}
