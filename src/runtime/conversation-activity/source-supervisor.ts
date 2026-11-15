import { configHex, configScope, sameConfigScope, configNonce, configPathSame } from './source-supervisor-config-data.js';
import { mintCanonicalDesktopConfigBirth as configBirthImplementation } from './source-supervisor-config-birth.js';
import type { ConfigRetirement, ConfigTarget, ConfigEndpointObserver, ConfigSupervisor, CanonicalDesktopConfigEndpoint, ActivityManagedSource, SourceReceipt } from './source-supervisor-types.js';
export type * from './source-supervisor-types.js';
import { bindOriginalSupervisedBusinessEndpoint as supervisedBusinessImplementation } from './source-supervisor-business.js';
import { bindCanonicalDesktopConfigBirth as canonicalConfigImplementation } from './source-supervisor-config.js';
import { readProcessBirth as processBirthImplementation } from './source-supervisor-birth.js';
import { chmodPrivateActivityFile, writePrivateActivityFile, ensurePrivateActivityFile } from './storage-permissions.js';

import { ACTIVITY_STORAGE_NAMES } from './storage-permissions.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';


import { createIntrinsicSet } from '../verification/intrinsic-async-collection.js';
import { assertStandardIpcPromise } from '../verification/native-ipc-promise.js';
import type { ActivityOwnerConfig } from './owner-runtime.js';



import { type CanonicalSupervisedBusinessPort } from './canonical-dispatch-business.js';
import { readFileSync, renameSync, existsSync, openSync, closeSync, statSync } from 'node:fs';
import { z } from 'zod';
import { join, isAbsolute } from 'node:path';

const configPromise=Promise,configThen=Promise.prototype.then,configApply=Reflect.apply,configFreeze=Object.freeze,configCreate=Object.create,configDefine=Object.defineProperty;
const ConfigWeakMap=WeakMap;
const configWeakGet=WeakMap.prototype.get,configWeakSet=WeakMap.prototype.set,configPrototype=Object.getPrototypeOf,configQueue=queueMicrotask,configSetPrototype=Object.setPrototypeOf;
const configAsyncPrototype=configPrototype(async()=>{}),configJson=JSON.stringify,configBytes=Buffer.byteLength,configRemove=process.removeListener;
const configBirths=new WeakMap<object,{configFile:string;channel:object;send:NonNullable<NodeJS.Process['send']>;used:boolean}>();





const configSupervisors=new WeakMap<object,ConfigSupervisor>(),configMapGet=Map.prototype.get,configObjectKeys=Object.keys,configOwn=Object.hasOwn,configDescriptors=Object.getOwnPropertyDescriptors,configCharCode=String.prototype.charCodeAt;
function configOwner(supervisor:object):ConfigSupervisor|undefined{return configApply(configWeakGet,configSupervisors,[supervisor]) as ConfigSupervisor|undefined;}
function retireConfigTarget(owner:ConfigSupervisor,target:ConfigTarget):ConfigRetirement|undefined{
 if(target.retirement||!target.client)return target.retirement;
 let complete!:()=>void;const record:ConfigRetirement={completion:new configPromise<void>(yes=>{complete=yes;}),complete(){complete();},unknown:false};configDefine(record.completion,'constructor',{__proto__:null,value:configPromise} as PropertyDescriptor);target.retirement=record;owner.retirements.add(record);
 try{const raw=target.client.sealAndDrainPrefix();record.raw=raw;assertStandardIpcPromise(raw,'activity_config_target_tail_unknown');void configApply(configThen,raw,[()=>{complete();},(error:unknown)=>{record.failure=error;complete();}]);}catch(error){record.unknown=true;record.failure=error;}
 return record;
}
function revokeConfigTarget(owner:ConfigSupervisor):void{
 const target=owner.target;if(!target||target.revoked)return;target.revoked=true;
 owner.business?.revoke(target);
 const endpoints=owner.endpoints.snapshot();for(let i=0;i<endpoints.length;i++)endpoints[i]!.targetRevoked(target);
 retireConfigTarget(owner,target);
}

export function revokeSupervisedKSwarmConfigTarget(supervisor:object):void{const owner=configOwner(supervisor);if(!owner)throw Error('activity_config_original_supervisor_required');revokeConfigTarget(owner);}


export function bindOriginalSupervisedBusinessEndpoint(supervisor:object,endpoint:object):CanonicalSupervisedBusinessPort {return supervisedBusinessImplementation(supervisor,endpoint,supervisedBusinessContextValue);}
function registerConfigTarget(supervisor:ActivitySourceSupervisor,child:ChildProcess,source:ActivityManagedSource,env:NodeJS.ProcessEnv):void{
 if(source.name!=='kswarm')return;const owner=configOwner(supervisor);if(!owner)return;revokeConfigTarget(owner);
 const fields=configDescriptors(source.env),p=fields.KSWARM_DESKTOP_PROFILE_ID,w=fields.KSWARM_DESKTOP_WORKSPACE_ID;
 if(!p||!w||!configOwn(p,'value')||!configOwn(w,'value')||!configHex(p.value)||!configHex(w.value)||env.KSWARM_DESKTOP_PROFILE_ID!==p.value||env.KSWARM_DESKTOP_WORKSPACE_ID!==w.value||child.connected!==true)return;
 if(!Number.isSafeInteger(owner.generation+1))return;const target:ConfigTarget={child,generation:++owner.generation,scope:configFreeze({profileId:p.value,workspaceId:w.value}),revoked:false};owner.target=target;
 const revoke=()=>{if(owner.target===target)revokeConfigTarget(owner);};child.once('error',revoke);child.once('disconnect',revoke);child.once('exit',revoke);child.once('close',revoke);
}


const configProtocol='activity_desktop_config_v1';

export function mintCanonicalDesktopConfigBirth():object|undefined{return configBirthImplementation(configBirthContextValue);}
const configCloseCustody=new WeakMap<object,(settled:(error?:unknown)=>void)=>void>();
export function observeCanonicalDesktopConfigClose(endpoint:object,settled:(error?:unknown)=>void):void{
 const observe=configApply(configWeakGet,configCloseCustody,[endpoint]) as ((settled:(error?:unknown)=>void)=>void)|undefined;if(!observe)throw Error('activity_config_original_endpoint_required');observe(settled);
}




export function bindCanonicalDesktopConfigBirth(birth:object,supervisor:ActivitySourceSupervisor,configFile:string,config:ActivityOwnerConfig):CanonicalDesktopConfigEndpoint {return canonicalConfigImplementation(birth,supervisor,configFile,config,canonicalConfigContextValue);}





export const SOURCE_START_DEADLINE_MS = 10_000;

const BIRTH_LOOKUP_TIMEOUT_MS = 3000;

export function readProcessBirth(pid:number,timeoutMs:number=BIRTH_LOOKUP_TIMEOUT_MS):Promise<string>{return processBirthImplementation(pid,timeoutMs,processBirthContextValue);}
function birth(pid: number, timeoutMs?: number): Promise<string> { return readProcessBirth(pid, timeoutMs); }


export class ActivitySourceSupervisor {
  private readonly children = new Map<string, ChildProcess>();
  private readonly receipts = new Map<string, SourceReceipt>();
  private readonly pending = new Map<string, Promise<SourceReceipt>>();
  private closing = false;
  private shutdown?: Promise<void>;
  private readonly stopping = new Set<Promise<void>>();
  // Actual handles created by this instance, never ledger/PID-derived handles.
  private readonly childCloses = new Map<ChildProcess, Promise<void>>();
  private trackChildClose(child: ChildProcess): void {
    const closed = new Promise<void>(resolve => child.once('close', () => {
      this.childCloses.delete(child); resolve();
    }));
    this.childCloses.set(child, closed);
  }

  sealAndDrainSpawned(): Promise<void> {
    const owner=configOwner(this);if(owner)revokeConfigTarget(owner);
    this.closing = true;
    return this.shutdown ??= (async () => {
      const admissions = await Promise.allSettled([...this.pending.values(), ...this.stopping]);
      // A late admitted ensure can create the actual target after initial seal.
      if(owner){revokeConfigTarget(owner);await owner.business?.join();}
      // Admitted ensures may finish producing a handle; snapshot AFTER they settle.
      // Never resolve this barrier just because a request's own timeout expired.
      await Promise.all([...this.childCloses.values()]);
      const failures = admissions.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (failures.length) throw new AggregateError(failures, 'activity_source_shutdown_failed');
    })();
  }

  constructor(private readonly root: string, readonly ownerEpoch: string) {
    const ledger = join(root, ACTIVITY_STORAGE_NAMES.supervision);
    if (existsSync(ledger)) {
      const state = statSync(ledger);
      if (state.size > 16_384 || process.platform !== 'win32' && (state.uid !== process.getuid?.() || (state.mode & 0o077) !== 0)) throw new Error('activity_source_ledger_not_private');
      const document = z.object({ version: z.literal(1), sources: z.array(z.object({ name: z.enum(['broker','kswarm']), pid: z.number().int().nonnegative(), birth: z.string().max(256), entryHash: z.string().length(64), ownerEpoch: z.string().min(1).max(256), external: z.boolean(), instanceId: z.string().max(256).optional() }).strict()).max(2) }).strict().parse(JSON.parse(readFileSync(ledger, 'utf8')));
      for (const receipt of document.sources) this.receipts.set(receipt.name, receipt);
    }
    const owner:ConfigSupervisor={ownerEpoch,generation:0,configBound:false,business:undefined,retirements:createIntrinsicSet<ConfigRetirement>(),endpoints:createIntrinsicSet<ConfigEndpointObserver>(),isCurrent:target=>!this.closing&&!target.revoked&&owner.target===target&&configApply(configMapGet,this.children,['kswarm'])===target.child&&target.child.connected===true&&target.child.exitCode===null&&target.child.signalCode===null};configApply(configWeakSet,configSupervisors,[this,owner]);
  }
  private save(): void {
    const file = join(this.root, ACTIVITY_STORAGE_NAMES.supervision), temporary = `${file}.${process.pid}.tmp`;
    writePrivateActivityFile(temporary, JSON.stringify({ version: 1, sources: [...this.receipts.values()] })); renameSync(temporary, file);
  }
  private readonly connectionFailures=new Set<string>();
  private async healthy(source: ActivityManagedSource, pid?: number): Promise<boolean> {
    let connected=false;
    try {
      const response = await fetch(source.healthUrl, { headers: source.healthHeaders, signal: AbortSignal.timeout(1000) });
      connected=true;this.connectionFailures.delete(source.name);
      if (!response.ok || !Object.keys(source.expectedHealth).length) return false;
      const payload = await response.json() as unknown;
      if (pid !== undefined && (payload as { service?: { pid?: number } })?.service?.pid !== pid) return false;
      return Object.entries(source.expectedHealth).every(([path, expected]) => {
        let actual: unknown = payload;
        for (const key of path.split('.')) actual = actual && typeof actual === 'object' ? (actual as Record<string, unknown>)[key] : undefined;
        return actual === expected;
      });
    }
    catch { if(!connected)this.connectionFailures.add(source.name);return false; }
  }
  private alive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw new Error('activity_source_liveness_unconfirmed'); }
  }
  ensure(source: ActivityManagedSource): Promise<SourceReceipt> {
    if (this.closing) return Promise.reject(new Error('activity_source_closing'));
    const existing = this.pending.get(source.name); if (existing) return existing;
    const pending = this.ensureSource(source).finally(() => { if (this.pending.get(source.name) === pending) this.pending.delete(source.name); });
    this.pending.set(source.name, pending); return pending;
  }
  private async ensureSource(source: ActivityManagedSource): Promise<SourceReceipt> {
    if (!isAbsolute(source.entryPath) || !isAbsolute(source.cwd) || !existsSync(source.entryPath)) throw new Error('activity_source_entry_invalid');
    const entryHash = createHash('sha256').update(readFileSync(source.entryPath)).digest('hex');
    const previous = this.receipts.get(source.name);
    if (previous && !previous.external) {
      if (!this.alive(previous.pid)) {if(source.name==='kswarm'){const owner=configOwner(this);if(owner){revokeConfigTarget(owner);await owner.business?.join();}}this.receipts.delete(source.name); this.save(); return this.ensureSource(source); }
      if (previous.entryHash !== entryHash || await birth(previous.pid) !== previous.birth) throw new Error('activity_source_identity_mismatch');
      if (await this.healthy(source, previous.pid)) { const receipt = { ...previous, ownerEpoch: this.ownerEpoch }; this.receipts.set(source.name, receipt); this.save(); return receipt; }
      throw new Error('activity_supervised_source_unhealthy');
    }
    if (await this.healthy(source)) {
      // A verified independent external endpoint may be observed, but it is
      // not an owned PID and cannot acquire this supervisor's kill authority.
      const receipt = { name: source.name, pid: 0, birth: '', entryHash, ownerEpoch: this.ownerEpoch, external: true };
      this.receipts.set(source.name, receipt); this.save(); return receipt;
    }
    if(source.name==='kswarm'){const owner=configOwner(this);if(owner){revokeConfigTarget(owner);await owner.business?.join();}}
    const logPath = join(this.root, source.name === 'kswarm' ? ACTIVITY_STORAGE_NAMES.kswarmLog : ACTIVITY_STORAGE_NAMES.brokerLog);
    ensurePrivateActivityFile(logPath);
    const log = openSync(logPath, 'a', 0o600);
    const launchEnv=Object.freeze({...process.env,...source.env});
    let child: ChildProcess;
    try {
      chmodPrivateActivityFile(logPath);
      child = spawn(source.executable, source.args ?? [source.entryPath], { cwd: source.cwd, env: launchEnv, detached: true,
        stdio: source.name === 'kswarm' ? ['ignore', log, log, 'ipc'] : ['ignore', log, log], windowsHide: true });
      this.trackChildClose(child);
    } finally { closeSync(log); }
    let failure: unknown; child.once('error', error => { failure = error; }); child.unref();
    // Preserve the original idle-parent lifetime; unref is not a drain receipt.
    if (source.name === 'kswarm') child.channel?.unref();
    if (!child.pid) throw new Error('activity_source_spawn_failed');
    this.children.set(source.name, child);
    // From spawn until a receipt is returned, any failure (birth lookup,
    // receipt save, health probe, timeout) reaps the actual child first. A
    // child left running keeps its cwd and listener and becomes an orphan.
    try {
      // One start deadline covers the birth lookup and the health wait.
      const until = Date.now() + SOURCE_START_DEADLINE_MS;
      registerConfigTarget(this,child,source,launchEnv);
      const receipt: SourceReceipt = { name: source.name, pid: child.pid, birth: await birth(child.pid, Math.max(1, until - Date.now())), entryHash, ownerEpoch: this.ownerEpoch, external: false };
      this.receipts.set(source.name, receipt); this.save();
      this.connectionFailures.delete(source.name);
      while (Date.now() < until) { if (failure || child.exitCode !== null) throw new Error('activity_source_start_failed'); if (await this.healthy(source, child.pid)) return receipt; await new Promise(resolve => setTimeout(resolve, 100)); }
      // A child that never proved health is not a usable source. Leaving it
      // running orphans its listener (e.g. Broker on 4318) once the owner exits,
      // and every later launcher then fails with EADDRINUSE.
      throw new Error(process.platform==='win32'&&this.connectionFailures.has(source.name)?'activity_source_start_timeout:local_connection_unavailable':'activity_source_start_timeout');
    } catch (error) {
      await this.reapUnstarted(source.name, child);
      throw error;
    }
  }

  private async reapUnstarted(name: string, child: ChildProcess): Promise<void> {
    if(name==='kswarm'){const owner=configOwner(this);if(owner){revokeConfigTarget(owner);await owner.business?.join();}}
    const closed = this.childCloses.get(child);
    if (child.exitCode === null && child.signalCode === null) { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
    if (closed) await closed;
    if (this.children.get(name) === child) this.children.delete(name);
    if (this.receipts.get(name)?.pid === child.pid) { this.receipts.delete(name); this.save(); }
  }
  async protectedPid(pid: number): Promise<boolean> {
    const receipt = [...this.receipts.values()].find(item => !item.external && item.pid === pid);
    return Boolean(receipt && this.alive(pid) && await birth(pid) === receipt.birth);
  }
  stopOwned(name: string, expectedOwnerEpoch: string): Promise<void> {
    if (this.closing) return Promise.reject(new Error('activity_source_closing'));
    const pending = this.stopOwnedSource(name, expectedOwnerEpoch).finally(() => { this.stopping.delete(pending); });
    this.stopping.add(pending); return pending;
  }
  private async stopOwnedSource(name: string, expectedOwnerEpoch: string): Promise<void> {
    if (expectedOwnerEpoch !== this.ownerEpoch) throw new Error('activity_source_stale_lease');
    const ledger = JSON.parse(readFileSync(join(this.root, ACTIVITY_STORAGE_NAMES.supervision), 'utf8')) as { sources: SourceReceipt[] };
    if (ledger.sources.find(item => item.name === name)?.ownerEpoch !== this.ownerEpoch) throw new Error('activity_source_stale_lease');
    const receipt = this.receipts.get(name);
    if (!receipt || receipt.external) throw new Error('activity_source_stop_unconfirmed');
    if(name==='kswarm'){const owner=configOwner(this);if(owner){revokeConfigTarget(owner);await owner.business?.join();}}
    if (!this.alive(receipt.pid)) { this.receipts.delete(name); this.children.delete(name); this.save(); return; }
    if (!await this.protectedPid(receipt.pid)) throw new Error('activity_source_stop_unconfirmed');
    process.kill(receipt.pid, 'SIGTERM');
    const deadline = Date.now() + 5000;
    while (this.alive(receipt.pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    if (this.alive(receipt.pid)) throw new Error('activity_source_stop_pending');
    this.receipts.delete(name); this.children.delete(name); this.save();
  }
}

const supervisedBusinessContextValue={configPromise,configThen,configApply,configFreeze,configCreate,configDefine,ConfigWeakMap,configWeakGet,configWeakSet,configPrototype,configSetPrototype,configJson,configOwn,sameConfigScope,configOwner};
export type supervisedBusinessContext=typeof supervisedBusinessContextValue;
const canonicalConfigContextValue={configPromise,configThen,configApply,configFreeze,configCreate,configDefine,configWeakGet,configWeakSet,configPrototype,configQueue,configRemove,configBirths,configObjectKeys,configOwn,configDescriptors,configHex,configScope,sameConfigScope,configOwner,retireConfigTarget,configProtocol,configNonce,configPathSame,configCloseCustody};
export type canonicalConfigContext=typeof canonicalConfigContextValue;
const processBirthContextValue={BIRTH_LOOKUP_TIMEOUT_MS};
export type processBirthContext=typeof processBirthContextValue;

const configBirthContextValue={configPathSame,configPrototype,configAsyncPrototype,configFreeze,configCreate,configApply,configWeakSet,configBirths};
export type configBirthContext=typeof configBirthContextValue;


export function assertOriginalSupervisorImplementationContext(value:unknown,kind:'business'|'config'|'birth'|'process'):void {
 const expected=kind==='business'?supervisedBusinessContextValue:kind==='config'?canonicalConfigContextValue:kind==='birth'?configBirthContextValue:kind==='process'?processBirthContextValue:undefined;
 if(!expected||value!==expected)throw Error('activity_original_implementation_context_required');
}
