import {guestInstallationLock,guestArchiveInstall} from './guest-installation-phase.js';
import type {Database} from 'better-sqlite3';
import {verifyEngineBinaryCensus,ENGINE_BINARY_CENSUS_SCRIPT} from './engine-binary-census.js';
import {runInstallationCommand,assertInstallationCommandIdle} from './installation-command.js';
import {readFileSync,lstatSync,existsSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {assertInstalledControllerIdentity,assertRootProtectedFile,assertRootProtectedExecutable} from './installed-identity.js';
import {parseInstalledDeploymentManifest} from './deployment-manifest.js';
import {parseDeploymentPackageInventory,verifyDeploymentPackage} from './deployment-package.js';
import {buildPrivateMacEnginePlan} from './macos-engine-bootstrap.js';
import {createEngineBootstrapJournal,type EngineVmObservation} from './engine-bootstrap-journal.js';
import {recoverPrivateEngine} from './engine-bootstrap-coordinator.js';
import {writeFileAtomicallySync} from '../../utils/atomic-file.js';
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const installedHandles=new WeakMap<object,{current():void;inspect():Promise<unknown>;initialHash:string;database:Database}>();
export function assertInstalledMacEngineHandle(value:object):void{const facts=installedHandles.get(value);if(!facts)throw Error('installed_engine_handle');facts.current();}
export function assertInstalledEngineDatabase(value:object,database:Database):void{assertInstalledMacEngineHandle(value);if(installedHandles.get(value)!.database!==database)throw Error('installed_engine_database');}
export async function inspectInstalledMacEngineHandle(value:object):Promise<void>{const facts=installedHandles.get(value);if(!facts)throw Error('installed_engine_handle');facts.current();const observation=await facts.inspect();facts.current();if(hash(JSON.stringify(observation))!==facts.initialHash)throw Error('installed_engine_changed');}
/** Installed service only: fixed package/DB/VM. No injected executor or qualification flag.
 * Result is inspected installation facts; the qualified runner must still perform
 * actual escape/resource probes and bind its own engine lifetime. */
export async function initializeInstalledMacEngine(input:{database:Database;signal?:AbortSignal;recovery?:'explicit'}){
 if(!input||Object.keys(input).some(k=>!['database','signal','recovery'].includes(k))||input.recovery!==undefined&&input.recovery!=='explicit')throw Error('installed_engine_arguments');
 if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('installed_engine_platform');
 const base='/Library/Application Support/xiaok-verification',state=join(base,'state'),manifestPath=join(base,'deployment.json');
 assertInstallationCommandIdle(state);assertRootProtectedFile(manifestPath);const manifestBytes=readFileSync(manifestPath);if(manifestBytes.length>65536)throw Error('installed_engine_manifest');const manifest=parseInstalledDeploymentManifest(JSON.parse(manifestBytes.toString()));
 const release=join(base,'releases',manifest.packageHash),node=join(release,'bin/node');
 assertInstalledControllerIdentity({serviceUid:manifest.serviceUid,interactiveUids:manifest.allowedUserIds,executable:node,stateRoot:state});
 const inventoryPath=join(base,'releases',manifest.packageHash+'.json');assertRootProtectedFile(inventoryPath);const inventory=parseDeploymentPackageInventory(JSON.parse(readFileSync(inventoryPath,'utf8')));if(inventory.packageHash!==manifest.packageHash)throw Error('installed_engine_inventory');verifyDeploymentPackage(release,inventory);
 const db=input.database;if(db.inTransaction)throw Error('installed_engine_transaction');const files=db.pragma('database_list') as {name:string;file:string}[];if(files.length!==1||files[0].name!=='main'||realpathSync(files[0].file)!==join(state,'authority.sqlite'))throw Error('installed_engine_database');
 const sources=JSON.parse(readFileSync(join(release,'runtime-sources.json'),'utf8'));for(const key of ['baseImage','engine','workerImage'])if(!/^[a-f0-9]{64}$/.test(sources[key]?.sha256))throw Error('installed_engine_sources');if(!/^sha256:[a-f0-9]{64}$/.test(sources.workerImage.imageId))throw Error('installed_engine_image');
 const expectedBinaries=JSON.parse(readFileSync(join(release,'vm/engine-files.json'),'utf8'));
 const journal=createEngineBootstrapJournal(db),old=journal.read(),nonce=old?.proposal.creationNonce??randomBytes(32).toString('hex');
 const plan=buildPrivateMacEnginePlan({releaseRoot:release,stateRoot:state,baseImageSha256:sources.baseImage.sha256,dockerArchiveSha256:sources.engine.sha256,creationNonce:nonce});
 for(const executable of [plan.executable,join(release,'bin/process-observation')])assertRootProtectedExecutable(executable);
 function current(){input.signal?.throwIfAborted();assertInstalledControllerIdentity({serviceUid:manifest.serviceUid,interactiveUids:manifest.allowedUserIds,executable:node,stateRoot:state});if(!readFileSync(manifestPath).equals(manifestBytes))throw Error('installed_engine_deployment_changed');}
 function privateFile(path:string,max=2*1024**2){const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.uid!==manifest.serviceUid||stat.size>max||(stat.mode&0o022))throw Error('installed_engine_private_file');return readFileSync(path,'utf8');}
 async function run(executable:string,argv:readonly string[],stdin:string|Buffer='',timeoutMs=30000):Promise<string>{
  return (await runInstallationCommand({scope:state,executable,argv,cwd:state,env:plan.env,stdin,timeoutMs,signal:input.signal,assertCurrent:current})).toString('utf8');
 }
 const shell=(script:string,timeout=30000)=>run(plan.executable,['shell',plan.name,'sudo','-n','/bin/sh','-s'],script,timeout);
 if(existsSync(plan.configPath)){if(privateFile(plan.configPath)!==plan.configJson)throw Error('installed_engine_config_changed');}else{if(old)throw Error('installed_engine_config_missing');writeFileAtomicallySync(plan.configPath,plan.configJson,{requireDirectorySync:true});}
 const normalized=await run(plan.executable,['validate','--fill',plan.configPath]),configHash=hash(normalized);
 const proposal={deploymentHash:manifest.packageHash,configHash,creationNonce:nonce,vmName:'xiaok-engine' as const};journal.prepare(proposal);
 const fresh=journal.read()?.state==='prepared';
 if(fresh){journal.beginCreate(proposal);await run(plan.executable,plan.startArgv,'',900000);}else if(input.recovery!=='explicit'){
  // Ordinary restart may inspect a completed installation; it never resumes I/O.
  if(journal.read()?.phases?.['load-worker']?.state!=='complete')throw Error('installed_engine_explicit_recovery_required');
 }
 async function observeVm():Promise<EngineVmObservation>{
  const directory=join(state,'lima',plan.name),pidText=privateFile(join(directory,'qemu.pid'),64).trim();if(!/^[1-9][0-9]{0,9}$/.test(pidText))throw Error('installed_engine_pid');
  const before=JSON.parse(await run(join(release,'bin/process-observation'),[pidText]));if(before.uid!==manifest.serviceUid||before.realUid!==manifest.serviceUid||before.executable!==join(release,'bin/qemu-system-aarch64'))throw Error('installed_engine_process');
  const actualConfig=await run(plan.executable,['validate','--fill',join(directory,'lima.yaml')]);if(hash(actualConfig)!==configHash)throw Error('installed_engine_effective_config');
  const values=(await shell('set -eu\ncat /etc/machine-id\ncat /proc/sys/kernel/random/boot_id\ncat /etc/xiaok-controller-creation-nonce\n')).trim().split('\n');if(values.length!==3||!/^[a-f0-9]{32}$/.test(values[0])||!/^[a-f0-9-]{36}$/.test(values[1])||values[2]!==nonce)throw Error('installed_engine_guest_identity');
  const after=JSON.parse(await run(join(release,'bin/process-observation'),[pidText]));if(JSON.stringify(before)!==JSON.stringify(after))throw Error('installed_engine_process_changed');
  return {machineId:values[0],bootId:values[1],creationNonce:nonce,effectiveConfigHash:configHash,processUid:before.uid,processStartIdentity:before.startIdentity};
 }
 const archiveStatus=(path:string,digest:string)=>shell(`set -eu\nif [ ! -e '${path}' ] && [ ! -L '${path}' ]; then printf missing; else [ ! -L '${path}' ] && [ -f '${path}' ]; printf '%s  %s\\n' '${digest}' '${path}' | sha256sum -c - >/dev/null; printf complete; fi\n`).then(x=>{if(!['complete','missing'].includes(x))throw Error('installed_engine_archive');return x==='complete';});
 const docker='/usr/local/lib/xiaok-engine/docker --host unix:///run/xiaok-engine/docker.sock';
 const guestLock=guestInstallationLock(nonce);
 const copyArchive=async(file:'docker.tgz'|'worker.tar',target:string,digest:string)=>{
  if(target!=='/home/xiaokvm/'+file)throw Error('installed_engine_archive_target');const bytes=readFileSync(join(release,'vm',file));if(hash(bytes)!==digest)throw Error('installed_engine_archive_changed');
  await run(plan.executable,['shell',plan.name,'sudo','-n','/bin/sh','-c',guestArchiveInstall({creationNonce:nonce,file,sha256:digest})],bytes,180000);
 };
 async function engineFacts(){const raw=JSON.parse(await shell(`${docker} info --format '{{json .}}'\n`));if(typeof raw.ID!=='string'||!raw.ID||raw.OSType!=='linux'||!['aarch64','arm64'].includes(raw.Architecture))throw Error('installed_engine_info');return raw;}
 async function installationComplete(){const output=await shell(`set -eu\nif [ ! -e /etc/systemd/system/xiaok-engine.service ]; then printf missing; else [ ! -L /etc/systemd/system/xiaok-engine.service ]; printf '%s  %s\\n' '${hash(plan.unit)}' '/etc/systemd/system/xiaok-engine.service' | sha256sum -c - >/dev/null; if systemctl is-active --quiet xiaok-engine.service; then printf complete; else printf missing; fi; fi\n`);if(!['missing','complete'].includes(output))throw Error('installed_engine_unit');if(output==='complete')verifyEngineBinaryCensus(expectedBinaries,await shell(ENGINE_BINARY_CENSUS_SCRIPT));return output==='complete';}
 async function imageComplete(){const result=await shell(`set -eu\nif ${docker} image inspect '${sources.workerImage.imageId}' >/dev/null 2>&1; then ${docker} image inspect '${sources.workerImage.imageId}' --format '{{.Id}}'; else printf missing; fi\n`);if(result.trim()==='missing')return false;if(result.trim()!==sources.workerImage.imageId)throw Error('installed_engine_image');return true;}
 const observe=async()=>({...await observeVm(),engineId:(await engineFacts()).ID as string});
 const observation=await recoverPrivateEngine({journal,proposal,signal:input.signal,ports:{assertCurrent:current,observeVm,observe,phases:[
  {name:'copy-engine',digest:sources.engine.sha256,isComplete:()=>archiveStatus('/home/xiaokvm/docker.tgz',sources.engine.sha256),apply:()=>copyArchive('docker.tgz','/home/xiaokvm/docker.tgz',sources.engine.sha256)},
  {name:'install-engine',digest:hash(plan.bootstrapScript),isComplete:installationComplete,apply:()=>shell(guestLock+'\n'+plan.bootstrapScript,180000).then(()=>{})},
  {name:'load-worker',digest:sources.workerImage.sha256,isComplete:imageComplete,apply:async()=>{await copyArchive('worker.tar','/home/xiaokvm/worker.tar',sources.workerImage.sha256);await shell(guestLock+`\n${docker} image load --input /home/xiaokvm/worker.tar\n`,180000);}}
 ]}});
 const handle=Object.freeze({observation,hostSocket:plan.hostSocket,imageDigest:sources.workerImage.imageId as string,assertCurrent:current,inspect:observe,qualified:false as const});
 installedHandles.set(handle,{current,inspect:observe,initialHash:hash(JSON.stringify(observation)),database:db});return handle;
}
