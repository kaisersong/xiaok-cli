import {isDeepStrictEqual,types as nativeTypes} from 'node:util';
import {assertStandardIpcPromise} from '../verification/native-ipc-promise.js';
import {createIntrinsicSet,appendIntrinsic,aggregateIntrinsicErrors} from '../verification/intrinsic-async-collection.js';
import {scanTaskStoreSdkChildren} from './source-sdk-children.js';
import {registerSourceSyncCustodyOwner,createSourceSyncCustodyContext,type SourceSyncSdkKind} from './source-sync-custody.js';
import {captureOriginalChildPreparation,readOriginalChildPreparationObservationTicket,readOriginalChildPreparationTicket,assertOriginalChildPreparationSnapshot,assertOriginalChildPreparationTransition,originalPreparedContentDigest,originalChildPreparationSourceData,assertOriginalChildPreparationInput} from './default-dispatch-preparation.js';
import {createKnownDirectoryWriterFence} from '../verification/known-directory-writer-fence.js';
import {assertOrdinarySourceWriterRoute,observeOrdinaryDirectoryWriter} from '../verification/ordinary-source-writer-observation.js';
import {assertCapturedJsonUniqueKeys} from '../verification/captured-source-json.js';
import {createCapturedTaskDeclarationAccumulator} from './captured-task-declarations.js';
import {observeTaskSnapshotCompletion,observeTaskSnapshotCompletionSync,withoutTaskCompletionObservation} from './snapshot-completion-observation.js';
import { DesktopTaskObservationStore,readOriginalTaskObservationProtection as sdkObservationRead,saveOriginalTaskObservationProtection as sdkObservationSave,readOriginalTaskObservationWorkerSource,readOriginalTaskObservationProtectionInWorker } from './protected-observation-store.js';
import {readCurrentOriginalRootExecutionContext} from '../verification/original-root-execution-context.js';
import type {OriginalHostWorkerContext,OriginalHostWorkerRequest} from './original-host-worker-types.js';
import { mergeProtectedObservationClosures } from '../../ai/runtime/protected-observation-closure.js';
import { createHash,randomUUID } from 'node:crypto';
import {writeFileAtomicallySync} from '../../utils/atomic-file.js';
import { readFileSync, lstatSync, realpathSync,openSync,closeSync,fstatSync,unlinkSync,renameSync } from 'node:fs';
import { acquireSaveLock } from '../../ai/runtime/session-store/mutation-lock.js';
import { appendFile, mkdir, open, readdir, readFile, rename, truncate, unlink, writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import type { ActiveTaskRef, DesktopTaskEvent, TaskSnapshot } from './types.js';

const syncIsPromise=nativeTypes.isPromise,syncIsProxy=nativeTypes.isProxy,syncPrototype=Object.getPrototypeOf,syncDescriptor=Object.getOwnPropertyDescriptor;
const SyncPromise=Promise,syncThen=Promise.prototype.then,syncApply=Reflect.apply,syncDefine=Object.defineProperty;
const sdkCreate=Object.create,sdkFreeze=Object.freeze,sdkOwn=Object.hasOwn,SdkError=Error,sdkString=String;
const sdkMkdir=mkdir,sdkReadFile=readFile,sdkWriteFile=writeFile,sdkRename=rename,sdkAppendFile=appendFile,sdkTruncate=truncate,sdkUnlink=unlink,sdkOpen=open,sdkReaddir=readdir;
const sdkLstat=lstatSync,sdkRealpath=realpathSync,sdkReadFileSync=readFileSync,sdkIsDate=nativeTypes.isDate;
const sdkWeakGet=WeakMap.prototype.get,sdkWeakSet=WeakMap.prototype.set;
const SdkWeakMap=WeakMap,sdkDescriptors=Object.getOwnPropertyDescriptors,sdkKeys=Reflect.ownKeys,sdkInteger=Number.isSafeInteger;
const sdkOpenSync=openSync,sdkPlatform=process.platform,sdkCloseSync=closeSync,sdkFstat=fstatSync,sdkUnlinkSync=unlinkSync,sdkRenameSync=renameSync;
const sdkDate=Date,sdkMath=Math,sdkNow=Date.now,sdkRandom=Math.random,sdkNumberText=Number.prototype.toString,sdkSlice=String.prototype.slice,sdkPid=process.pid,sdkFinite=Number.isFinite;
const sdkGet=Reflect.get,sdkIsError=nativeTypes.isNativeError;
const identityUuid=randomUUID,identityExec=RegExp.prototype.exec;
const identityRecordPattern=/^\{"version":1,"hostId":"([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})"\}\n$/;
export interface OriginalTaskHostIdentity {readonly version:1;readonly hostId:string}
export interface OriginalTaskStoreHostIdentityIO {initialize():Promise<Readonly<OriginalTaskHostIdentity>>;read():Promise<Readonly<OriginalTaskHostIdentity>|null>}
const hostIdentityStores=new SdkWeakMap<object,Readonly<OriginalTaskStoreHostIdentityIO>>();
const hostIdentityBusyErrors=new SdkWeakMap<object,true>();
function hostIdentityBusy():never{const error=new SdkError('TASK_HOST_IDENTITY_BUSY');syncApply(sdkWeakSet,hostIdentityBusyErrors,[error,true]);throw error;}
/** Same original Store membership only. UUID metadata is never a permission. */
export function readOriginalTaskStoreHostIdentityIO(store:unknown):Readonly<OriginalTaskStoreHostIdentityIO>{
 const io=store&&typeof store==='object'?syncApply(sdkWeakGet,hostIdentityStores,[store]) as Readonly<OriginalTaskStoreHostIdentityIO>|undefined:undefined;
 if(!io)throw new SdkError('TASK_HOST_IDENTITY_STORE_REQUIRED');return io;
}
export interface OriginalTaskStorePhysicalCut {waitKnown():Promise<void>;assertKnown():void}
export interface OriginalTaskStorePhysicalIO {capture():OriginalTaskStorePhysicalCut}
const physicalStores=new SdkWeakMap<object,OriginalTaskStorePhysicalIO>();
/** Component-only physical inventory, never a writer or execution permission. */
export function readOriginalTaskStorePhysicalIO(store:unknown):OriginalTaskStorePhysicalIO {
 const io=syncApply(sdkWeakGet,physicalStores,[store]) as OriginalTaskStorePhysicalIO|undefined;
 if(!io)throw new SdkError('TASK_STORE_ORIGINAL_PHYSICAL_IO_REQUIRED');return io;
}
interface StorePhysicalOperation {done:boolean;promise:Promise<void>;resources:unknown[];raws:unknown[]}
interface ProtectionWorkerBirth {store:object;provider:object;taskId:string;operation:StorePhysicalOperation;active:boolean;context:Readonly<OriginalHostWorkerContext>;request:Readonly<OriginalHostWorkerRequest>}
const protectionWorkerBirths=new SdkWeakMap<object,ProtectionWorkerBirth>();
export function readOptionalOriginalTaskStoreProtectionWorkerContext(ticket:unknown,store:unknown):Readonly<OriginalHostWorkerContext>|undefined {
 const row=syncApply(sdkWeakGet,protectionWorkerBirths,[ticket]) as ProtectionWorkerBirth|undefined;
 if(!row)return undefined;
 if(row.store!==store)throw new SdkError('TASK_STORE_PROTECTION_WORKER_CONTEXT_REQUIRED');
 row.context.assertLocal();return row.context;
}
export function readOptionalOriginalTaskStoreProtectionWorkerRequest(ticket:unknown,provider?:unknown,taskId?:unknown):Readonly<OriginalHostWorkerRequest>|undefined {
 const row=syncApply(sdkWeakGet,protectionWorkerBirths,[ticket]) as ProtectionWorkerBirth|undefined;
 if(!row)return undefined;
 if(arguments.length>1&&(row.provider!==provider||row.taskId!==taskId))throw new SdkError('TASK_STORE_PROTECTION_WORKER_REQUEST_REQUIRED');
 return row.request;
}
interface StorePhysicalJob {done:boolean;operations:StorePhysicalOperation[];raws:unknown[];resources:unknown[]}
type SourceStoreContext=Readonly<{assertCurrent():void;cleanup?:true;sync?:object}>;
interface SyncTemp {path:string;identity?:{dev:unknown;ino:unknown};deferred?:boolean}
interface SyncDescriptor {descriptor:number;temp?:SyncTemp;closing:boolean;deferred?:boolean}
interface SyncDatabase {database:object;close?:Function;closing:boolean;deferred?:boolean;exclusive:boolean}
interface SourceSyncState {context:SourceStoreContext;purpose:'prepare'|'observe';cleaning:boolean;tempProbe?:string;finalReadPath?:string;deadPid?:number;pending:ReturnType<typeof createIntrinsicSet<Promise<void>>>;seen:ReturnType<typeof createIntrinsicSet<object>>;descriptors:ReturnType<typeof createIntrinsicSet<SyncDescriptor>>;temps:ReturnType<typeof createIntrinsicSet<SyncTemp>>;locks:ReturnType<typeof createIntrinsicSet<string>>;lockPaths:ReturnType<typeof createIntrinsicSet<string>>;databases:ReturnType<typeof createIntrinsicSet<SyncDatabase>>}
type SourceSdkKind='mkdir'|'string'|'void'|'resource'|'protection'|'fd'|'names';
interface SourceSdkOutcome {value:unknown;failure?:{error:unknown};unknown:boolean;fulfilled:boolean}
function sdkBox<T>(value:T):{value:T}{const box=sdkCreate(null);syncDefine(box,'value',{__proto__:null,value,enumerable:true} as PropertyDescriptor);return box;}
function sdkFailure(error:unknown):{error:unknown}{const failure=sdkCreate(null);syncDefine(failure,'error',{__proto__:null,value:error,enumerable:true} as PropertyDescriptor);return failure;}
export interface TaskSnapshotWriteReceipt { readonly opaqueTaskSnapshotWriteReceipt: never }
export interface TaskSnapshotWriteFacts {
  readonly taskId: string;
  readonly sessionId: string;
  readonly status: TaskSnapshot['status'];
  readonly sequence: number;
  readonly snapshotDigest: string;
}
const writeReceipts = new WeakMap<object, { store: FileTaskSnapshotStore; facts: Readonly<TaskSnapshotWriteFacts> }>();
export function getTaskSnapshotWriteReceipt(receipt: TaskSnapshotWriteReceipt, store: FileTaskSnapshotStore): Readonly<TaskSnapshotWriteFacts> {
  const entry = receipt && typeof receipt === 'object' ? writeReceipts.get(receipt) : undefined;
  if (!entry || entry.store !== store) throw Error('task_snapshot_write_receipt');
  return entry.facts;
}

interface SnapshotIndex {
  activeTaskIds: string[];
}

interface CheckpointPersistence {
  version: 1;
  lastSequence: number;
  checkpointEventCount?: number;
}

interface JournalPayload {
  version: 1;
  taskId: string;
  sequence: number;
  previousSequence: number;
  events: DesktopTaskEvent[];
  patch: Record<string, unknown>;
  removed: string[];
}

interface JournalRecord extends JournalPayload {
  checksum: string;
}

interface CachedSnapshot {
  snapshot: TaskSnapshot;
  sequence: number;
  checkpointEventCount: number;
  sealed: boolean;
  journalRepairOffset?: number;
}

/** Source data from the original retained files, never a permission receipt.
 * Scope remains untrusted data until the original Main source owner checks it. */
export interface OriginalTaskUserInput {
  taskId:string;sessionId:string;threadId:string|null;prompt:string;executionScope?:unknown;executionProtected?:true;protectedObservationClosure?:TaskSnapshot['protectedObservationClosure'];
}

export interface TaskSnapshotStoreDiagnostics {
  onWrite?: (operation: 'checkpoint' | 'journal' | 'index', bytes: number) => void;
}

/** Internal delivery continuation only; tracking is of unmodified physical IO. */
export interface TaskSnapshotReadOptions {
  signal: AbortSignal;
  trackPending(raw: Promise<unknown>): void;
}

const CHECKPOINT_META_KEY = '__xiaokJournal';
const TERMINAL_STATUSES = new Set<TaskSnapshot['status']>(['completed', 'failed', 'cancelled']);

/**
 * A legacy-readable checkpoint plus an append-only mutation journal.
 *
 * Running tasks append only the event suffix and changed top-level fields.
 * Terminal transitions materialize the complete historical TaskSnapshot so
 * older readers keep seeing completed tasks without understanding journals.
 */
const sourceReadConsumptions=new WeakMap<TaskSnapshotReadOptions,Map<Promise<unknown>,unknown>>();
const knownTaskWriters=new WeakMap<object,{fence:ReturnType<typeof createKnownDirectoryWriterFence>;pending?:Promise<void>}>();
export interface OriginalPreparationStoreBinding {readonly store:FileTaskSnapshotStore;readonly identity:object}
export interface OriginalPreparationStoreIO {drain():Promise<void>;prepare(ticket:unknown):ReturnType<FileTaskSnapshotStore['prepareDefaultDispatchSnapshot']>;observe(ticket:unknown):ReturnType<FileTaskSnapshotStore['readDefaultDispatchPreparation']>}
const preparationStoreBirths=new WeakMap<object,{view:Readonly<OriginalPreparationStoreBinding>;io:Readonly<OriginalPreparationStoreIO>}>();
const preparationStoreApply=Reflect.apply,preparationStoreGet=WeakMap.prototype.get,preparationStoreSet=WeakMap.prototype.set,preparationStoreFreeze=Object.freeze,preparationStoreCreate=Object.create;
/** Passive construction identity only. This neither observes a checkpoint nor
 * grants a ticket, write, Native readiness or physical-drain qualification. */
export function readOriginalPreparationStoreBinding(store:unknown):Readonly<OriginalPreparationStoreBinding>{
 const value=store&&typeof store==='object'?preparationStoreApply(preparationStoreGet,preparationStoreBirths,[store]) as {view:Readonly<OriginalPreparationStoreBinding>;io:Readonly<OriginalPreparationStoreIO>}|undefined:undefined;
 if(!value)throw Error('DEFAULT_DISPATCH_PREPARATION_STORE_REQUIRED');return value.view;
}
/** Original store membership and birth identity precede candidate properties.
 * The fixed closures enter the same original private queue and IO state. */
export function readOriginalPreparationStoreIO(store:unknown,identity:object):Readonly<OriginalPreparationStoreIO>{
 const entry=store&&typeof store==='object'?preparationStoreApply(preparationStoreGet,preparationStoreBirths,[store]) as {view:Readonly<OriginalPreparationStoreBinding>;io:Readonly<OriginalPreparationStoreIO>}|undefined:undefined;
 if(!entry||identity!==entry.view.identity)throw Error('DEFAULT_DISPATCH_PREPARATION_STORE_REQUIRED');return entry.io;
}
export class FileTaskSnapshotStore {
  readonly #observations: DesktopTaskObservationStore;
  readonly #unconfirmedSyncHandles=createIntrinsicSet<unknown>();
  #syncCloseFailure:unknown;
  #sourceSdkFailure:{error:unknown}|undefined;
  readonly #sourceSyncContexts=new SdkWeakMap<object,SourceSyncState>();
  #ordinaryIoContext:SourceStoreContext|undefined;
  readonly #physicalContextJobs=new SdkWeakMap<object,StorePhysicalJob>();
  readonly #physicalJobs=createIntrinsicSet<StorePhysicalJob>();
  readonly #physicalOperations=createIntrinsicSet<StorePhysicalOperation>();
  readonly #ownedSyncRaws=createIntrinsicSet<unknown>();
  #writerQueue: Promise<void> = Promise.resolve();
  #writerClosed = false;
  #assertWriterCurrent: (() => void) | undefined;
  #indexWriteQueue: Promise<void> = Promise.resolve();
  readonly #taskWriteQueues = new Map<string, Promise<void>>();
  readonly #cache = new Map<string, CachedSnapshot>();
  // Restriction cache only: absence may never lower facts this original owner
  // has already accepted. It stores no body and grants no execution authority.
  readonly #knownReadProtection=new Map<string,{closure?:TaskSnapshot['protectedObservationClosure'];executionProtected?:true}>();

  #hostIdentityKnown:{fact:Readonly<OriginalTaskHostIdentity>;cut:unknown}|undefined;
  #hostIdentityFailure:{error:unknown}|undefined;
  readonly #rootDir:string;
  readonly #diagnostics:TaskSnapshotStoreDiagnostics;
  get observations():DesktopTaskObservationStore{return this.#observations;}
  constructor(rootDir:string,diagnostics:TaskSnapshotStoreDiagnostics={}) {
    syncApply(sdkWeakSet,physicalStores,[this,sdkFreeze({capture:()=>this.#capturePhysicalCut()})]);
    registerSourceSyncCustodyOwner(this,(key,kind,method,args,receiver)=>this.#sourceSyncSdk(key,kind,method,args,receiver));
    this.#rootDir=resolve(rootDir);this.#diagnostics=diagnostics;
    this.#observations = new DesktopTaskObservationStore(this.#rootDir);knownTaskWriters.set(this,{fence:createKnownDirectoryWriterFence(this.#rootDir,'task-root')});
    syncApply(sdkWeakSet,hostIdentityStores,[this,sdkFreeze({__proto__:null,initialize:()=>this.#initializeHostIdentity(),read:()=>this.#readHostIdentity()})]);
    const identity=preparationStoreFreeze(preparationStoreCreate(null)),view=preparationStoreFreeze({__proto__:null,store:this,identity});
    const io:Readonly<OriginalPreparationStoreIO>=preparationStoreFreeze({__proto__:null,drain:()=>this.#closeAndDrain(),prepare:(ticket:unknown)=>this.#prepareDefaultDispatchSnapshot(ticket),observe:(ticket:unknown)=>this.#readDefaultDispatchPreparation(ticket)});
    preparationStoreApply(preparationStoreSet,preparationStoreBirths,[this,preparationStoreFreeze({__proto__:null,view,io})]);
  }

  #physicalJob(context?:SourceStoreContext):StorePhysicalJob|undefined {return context?syncApply(sdkWeakGet,this.#physicalContextJobs,[context]) as StorePhysicalJob|undefined:undefined;}
  #retainPhysicalRaw(value:unknown,context?:SourceStoreContext):void {this.#ownedSyncRaws.add(value);this.#physicalJob(context)?.raws.push(value);}
  #holdPhysicalResource(value:unknown,context?:SourceStoreContext):void {this.#unconfirmedSyncHandles.add(value);this.#physicalJob(context)?.resources.push(value);}
  #capturePhysicalCut():OriginalTaskStorePhysicalCut {
    const jobs=this.#physicalJobs.snapshot(),operations=this.#physicalOperations.snapshot();
    const raws=this.#ownedSyncRaws.snapshot(),resources=this.#unconfirmedSyncHandles.snapshot();
    const writer=this.#writerQueue,index=this.#indexWriteQueue,failure=this.#sourceSdkFailure;
    let settled=false;
    const checkRaw=(rows:unknown[])=>{for(let i=0;i<rows.length;i++)if(this.#ownedSyncRaws.has(rows[i]))throw new SdkError('TASK_STORE_PHYSICAL_UNKNOWN');};
    const checkResources=(rows:unknown[])=>{for(let i=0;i<rows.length;i++)if(this.#unconfirmedSyncHandles.has(rows[i]))throw new SdkError('TASK_STORE_PHYSICAL_UNKNOWN');};
    const checkOperation=(operation:StorePhysicalOperation)=>{if(!operation.done)throw new SdkError('TASK_STORE_PHYSICAL_PENDING');checkResources(operation.resources);checkRaw(operation.raws);};
    const assertKnown=()=>{
      if(!settled)throw new SdkError('TASK_STORE_PHYSICAL_PENDING');
      if(failure)throw new SdkError('TASK_STORE_PHYSICAL_UNKNOWN',{cause:failure.error});
      checkRaw(raws);checkResources(resources);
      for(let i=0;i<operations.length;i++)checkOperation(operations[i]!);
      for(let i=0;i<jobs.length;i++){const job=jobs[i]!;if(!job.done)throw new SdkError('TASK_STORE_PHYSICAL_PENDING');checkRaw(job.raws);checkResources(job.resources);for(let j=0;j<job.operations.length;j++)checkOperation(job.operations[j]!);}
    };
    return sdkFreeze({async waitKnown(){await writer;await index;for(let i=0;i<operations.length;i++)await operations[i]!.promise;for(let i=0;i<jobs.length;i++)for(let j=0;j<jobs[i]!.operations.length;j++)await jobs[i]!.operations[j]!.promise;settled=true;assertKnown();},assertKnown});
  }

  // Fixed data-only IO shares the original queue, lock and SDK resource owner.
  // Normal seal stops new roots; an already queued metadata operation keeps its
  // accepted SDK/cleanup tails. This is not a business or Native current grant.
  #identityContext(purpose:'prepare'|'observe'):SourceStoreContext {
    return this.#sourceContext(()=>{if(this.#hostIdentityFailure)throw this.#hostIdentityFailure.error;if(this.#sourceSdkFailure)throw this.#sourceSdkFailure.error;},purpose);
  }
  #identityStat(path:string,directory:boolean,context:SourceStoreContext):readonly unknown[]|null {
    let stat:any;try{stat=this.#sourceStat(path,context,true);}catch(error){if(!this.#sourceSdkFailure&&isNodeErrorCode(error,'ENOENT'))return null;throw error;}
    if(this.#statKind(stat,'symlink',context)||!this.#statKind(stat,directory?'directory':'file',context)||!directory&&stat.nlink!==1n)throw new SdkError('TASK_HOST_IDENTITY_UNCONFIRMED');
    // Directory mtime changes when the original atomic publisher creates its
    // temporary file. Only its original inode/mode is a lifetime identity.
    return directory?[stat.dev,stat.ino,stat.mode]:[stat.dev,stat.ino,stat.mode,stat.nlink,stat.size,stat.mtimeNs,stat.ctimeNs];
  }
  #readIdentitySerial(context:SourceStoreContext,locked:boolean):Readonly<OriginalTaskHostIdentity>|null {
    const directory=join(this.#rootDir,'.host-identity'),record=join(directory,'record.json');
    if(!locked&&this.#identityStat(join(this.#rootDir,'.task-store.save.lock'),false,context))hostIdentityBusy();
    const root=this.#identityStat(this.#rootDir,true,context),anchor=this.#identityStat(directory,true,context);
    if(!anchor){if(this.#hostIdentityKnown)throw new SdkError('TASK_HOST_IDENTITY_UNCONFIRMED');return null;}
    if(!root)throw new SdkError('TASK_HOST_IDENTITY_UNCONFIRMED');
    const before=this.#identityStat(record,false,context);if(!before)throw new SdkError('TASK_HOST_IDENTITY_UNCONFIRMED');
    const bytes=this.#sourceSyncSdk(context,'string',sdkReadFileSync,[record,'utf8']) as string;
    const match=syncApply(identityExec,identityRecordPattern,[bytes]) as RegExpExecArray|null;if(!match)throw new SdkError('TASK_HOST_IDENTITY_UNCONFIRMED');
    const hostId=match[1]!,birth=this.#identityStat(join(directory,`id-${hostId}`),true,context);if(!birth)throw new SdkError('TASK_HOST_IDENTITY_UNCONFIRMED');
    const cut=[root,anchor,birth,before,bytes];
    if(!isDeepStrictEqual(root,this.#identityStat(this.#rootDir,true,context))||!isDeepStrictEqual(anchor,this.#identityStat(directory,true,context))||!isDeepStrictEqual(birth,this.#identityStat(join(directory,`id-${hostId}`),true,context))||!isDeepStrictEqual(before,this.#identityStat(record,false,context)))throw new SdkError('TASK_HOST_IDENTITY_UNCONFIRMED');
    if(this.#hostIdentityKnown&&!isDeepStrictEqual(this.#hostIdentityKnown.cut,cut))throw new SdkError('TASK_HOST_IDENTITY_UNCONFIRMED');
    // A different original writer may acquire its actual lock during the
    // native read. The entry check alone is not a complete unlocked cut.
    if(!locked&&this.#identityStat(join(this.#rootDir,'.task-store.save.lock'),false,context))hostIdentityBusy();
    context.assertCurrent();
    const fact=sdkFreeze({__proto__:null,version:1 as const,hostId});
    this.#hostIdentityKnown={fact,cut};return fact;
  }
  #initializeHostIdentity():Promise<Readonly<OriginalTaskHostIdentity>> {
    if(this.#hostIdentityFailure)return SyncPromise.reject(this.#hostIdentityFailure.error);
    const context=this.#identityContext('prepare');
    return this.#enqueueWrite(undefined,async()=>{
      try{
        const existing=this.#readIdentitySerial(context,true);if(existing)return existing;
        const directory=join(this.#rootDir,'.host-identity');
        // A persistent namespace is the birth-attempt anchor. Never silently
        // repair a missing/corrupt record inside an existing namespace.
        await this.#sourceSdk(context,'mkdir',sdkMkdir,[directory,{mode:0o700}]);
        const hostId=this.#sourceSyncSdk(context,'uuid',identityUuid,[]) as string;
        if(!syncApply(identityExec,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,[hostId]))throw new SdkError('TASK_HOST_IDENTITY_UNCONFIRMED');
        await this.#sourceSdk(context,'mkdir',sdkMkdir,[join(directory,`id-${hostId}`),{mode:0o700}]);
        this.#assertWriterCurrent?.();
        this.#sourceSyncSdk(context,'void',writeFileAtomicallySync,[join(directory,'record.json'),`{"version":1,"hostId":"${hostId}"}\n`,{__proto__:null,sourceContext:context.sync,requireDirectorySync:true}]);
        this.#assertWriterCurrent?.();
        const fact=this.#readIdentitySerial(context,true);if(!fact)throw new SdkError('TASK_HOST_IDENTITY_UNCONFIRMED');return fact;
      }catch(error){this.#hostIdentityFailure??=sdkFailure(error);throw error;}
    },context);
  }
  #readHostIdentity():Promise<Readonly<OriginalTaskHostIdentity>|null> {
    if(this.#hostIdentityFailure)return SyncPromise.reject(this.#hostIdentityFailure.error);
    if(this.#writerClosed)return SyncPromise.reject(new SdkError('task_store_closed'));
    const context=this.#identityContext('observe');
    const run=syncApply(syncThen,this.#writerQueue,[async()=>{
      try{return this.#readIdentitySerial(context,false);}catch(error){if(!error||typeof error!=='object'||!syncApply(sdkWeakGet,hostIdentityBusyErrors,[error]))this.#hostIdentityFailure??=sdkFailure(error);throw error;}
      finally{await this.#joinSourceSync(context);}
    }]) as Promise<Readonly<OriginalTaskHostIdentity>|null>;
    syncDefine(run,'constructor',{__proto__:null,value:SyncPromise} as PropertyDescriptor);
    this.#writerQueue=syncApply(syncThen,run,[()=>undefined,()=>undefined]);return run;
  }

  #sourceContext(assertCurrent:()=>void,purpose:'prepare'|'observe'):SourceStoreContext{
    const context=sdkCreate(null) as SourceStoreContext;
    syncDefine(context,'assertCurrent',{__proto__:null,value:assertCurrent} as PropertyDescriptor);
    const state:SourceSyncState={context,purpose,cleaning:false,pending:createIntrinsicSet<Promise<void>>(),seen:createIntrinsicSet<object>(),descriptors:createIntrinsicSet<SyncDescriptor>(),temps:createIntrinsicSet<SyncTemp>(),locks:createIntrinsicSet<string>(),lockPaths:createIntrinsicSet<string>(),databases:createIntrinsicSet<SyncDatabase>()};
    syncApply(sdkWeakSet,this.#sourceSyncContexts,[context,state]);
    syncDefine(context,'sync',{__proto__:null,value:createSourceSyncCustodyContext(this,context)} as PropertyDescriptor);return sdkFreeze(context);
  }
  /** IO custody only. Ordinary write permission remains with the existing
   * writer-route/fence/lock checks; this context issues no Source authority. */
  #ordinaryContext():SourceStoreContext {
    return this.#ordinaryIoContext??=(this.#sourceContext(()=>{},'prepare'));
  }
  #syncState(key:object):SourceSyncState{
    const state=syncApply(sdkWeakGet,this.#sourceSyncContexts,[key]) as SourceSyncState|undefined;
    if(!state)throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_CONTEXT_REQUIRED');return state;
  }
  #syncInventory(state:SourceSyncState,value:unknown,rootPromise=false):void{
    const found=scanTaskStoreSdkChildren(value,rootPromise);
    for(let i=0;i<found.unknowns.length;i++){this.#retainPhysicalRaw(found.unknowns[i],state.context);this.#sourceSdkFailure??=sdkFailure(new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_UNCONFIRMED'));}
    for(let i=0;i<found.promises.length;i++)this.#syncRetain(state,found.promises[i]);
  }
  #syncRetain(state:SourceSyncState,raw:unknown):void{
    if(!raw||typeof raw!=='object'||state.seen.has(raw))return;state.seen.add(raw);this.#retainPhysicalRaw(raw,state.context);
    this.#syncInventory(state,raw,true);
    let finish!:()=>void;const completion=new SyncPromise<void>(yes=>{finish=yes;});syncDefine(completion,'constructor',{__proto__:null,value:SyncPromise} as PropertyDescriptor);state.pending.add(completion);
    const done=(value:unknown,failed:boolean)=>{
      try{if(failed)this.#sourceSdkFailure??=sdkFailure(value);this.#syncInventory(state,value);this.#ownedSyncRaws.delete(raw);}
      catch(error){this.#sourceSdkFailure??=sdkFailure(error);}
      state.pending.delete(completion);finish();
    };
    try{assertStandardIpcPromise(raw,'TASK_SNAPSHOT_SOURCE_SYNC_OBSERVER_UNKNOWN');syncApply(syncThen,raw,[(value:unknown)=>done(value,false),(error:unknown)=>done(error,true)]);}
    catch(error){this.#sourceSdkFailure??=sdkFailure(error);state.pending.delete(completion);finish();}
  }
  async #joinSourceSync(context?:SourceStoreContext):Promise<void>{
    if(!context)return;const state=this.#syncState(context);
    for(;;){
      const rows=state.pending.snapshot();for(let i=0;i<rows.length;i++)await rows[i]!;
      if(state.pending.size)continue;
      const descriptors=state.descriptors.snapshot();for(let i=0;i<descriptors.length;i++)if(descriptors[i]!.deferred){descriptors[i]!.deferred=false;try{this.#sourceSyncSdk(context,'fd-close',sdkCloseSync,[descriptors[i]!.descriptor]);}catch(error){this.#sourceSdkFailure??=sdkFailure(error);}}
      const databases=state.databases.snapshot();for(let i=0;i<databases.length;i++)if(databases[i]!.deferred){const row=databases[i]!;row.deferred=false;try{const close=row.close??this.#sourceSyncSdk(context,'db-method',sdkGet,[row.database,'close'],row.database) as Function;this.#sourceSyncSdk(context,'db-close',close,[],row.database);this.#sourceSyncSdk(context,'db-open-state',sdkGet,[row.database,'open'],row.database);}catch(error){this.#sourceSdkFailure??=sdkFailure(error);}}
      const temps=state.temps.snapshot();for(let i=0;i<temps.length;i++)if(temps[i]!.deferred){temps[i]!.deferred=false;try{this.#sourceSyncSdk(context,'unlink-temp',sdkUnlinkSync,[temps[i]!.path]);}catch(error){this.#sourceSdkFailure??=sdkFailure(error);}}
      if(!state.pending.size)return;
    }
  }
  #sourceSyncSdk(key:object,kind:SourceSyncSdkKind,method:Function,args:unknown[],receiver?:unknown):unknown{
    const state=this.#syncState(key);
    if(kind==='current'||kind==='lock-enter'){if(this.#sourceSdkFailure)throw this.#sourceSdkFailure.error;if(kind==='lock-enter'&&(state.purpose!=='prepare'||args.length!==1||typeof args[0]!=='string'))throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_LOCK_REQUIRED');state.context.assertCurrent();if(kind==='lock-enter')state.lockPaths.add(args[0] as string);return undefined;}
    const reservation=sdkCreate(null);this.#retainPhysicalRaw(reservation,state.context);
    let entered=false,returned=false;
    const resources=state.descriptors.snapshot();let held:SyncDescriptor|undefined;
    let renamedTemp:SyncTemp|undefined;
    for(let i=0;i<resources.length;i++)if(resources[i]!.descriptor===args[0])held=resources[i];
    const resourceCleanup=(kind==='fd-close'&&method===sdkCloseSync||kind==='fd-stat'&&method===sdkFstat)&&!!held;
    const lockCleanup=kind==='lock-release'&&method===sdkUnlinkSync&&state.locks.has(args[0] as string);
    const tempProbe=kind==='stat'&&method===sdkLstat&&state.tempProbe===args[0];
    let tempIdentityOpen=false;
    if(sdkPlatform==='win32'&&kind==='fd-open-read'&&method===sdkOpenSync&&args.length===2&&args[1]==='r'&&state.tempProbe===args[0]){
      const temps=state.temps.snapshot();for(let i=0;i<temps.length;i++)if(temps[i]!.path===args[0]&&temps[i]!.identity)tempIdentityOpen=true;
    }
    const finalRead=(kind==='stat'&&method===sdkLstat||kind==='string'&&method===sdkReadFileSync)&&state.finalReadPath===args[0];
    let database:SyncDatabase|undefined;const databases=state.databases.snapshot();for(let i=0;i<databases.length;i++)if(databases[i]!.database===receiver||databases[i]!.database===args[0])database=databases[i];
    const databaseCleanup=!!database&&(kind==='db-close'&&method===database.close||kind==='db-method'&&method===sdkGet&&args[1]==='close'||kind==='db-open-state'&&method===sdkGet&&args[1]==='open');
    try{
      if(this.#sourceSdkFailure&&!resourceCleanup&&!databaseCleanup&&!lockCleanup&&!tempProbe&&!finalRead&&kind!=='unlink-temp')throw this.#sourceSdkFailure.error;
      if(state.cleaning&&kind!=='stat'&&kind!=='string'&&kind!=='boolean'&&!resourceCleanup&&!databaseCleanup&&!lockCleanup&&!tempIdentityOpen&&kind!=='unlink-temp')throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_CLEANUP_REQUIRED');
      if(state.purpose==='observe'&&kind!=='stat'&&kind!=='string'&&kind!=='boolean'&&kind!=='fd-open-read'&&kind!=='fd-read'&&!resourceCleanup)throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_READ_ONLY');
      if(kind==='fd-read'&&(!held||held.temp))throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_READ_RESOURCE_REQUIRED');
      if(kind==='rename-temp'){
        const temps=state.temps.snapshot();for(let i=0;i<temps.length;i++)if(temps[i]!.path===args[0])renamedTemp=temps[i];
        if(method!==sdkRenameSync||!renamedTemp?.identity)throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_TEMP_REQUIRED');
        for(let i=0;i<resources.length;i++)if(resources[i]!.temp===renamedTemp)throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_TEMP_STILL_OPEN');
      }
      if((kind==='fd-close'||kind==='fd-stat')&&!resourceCleanup)throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_RESOURCE_REQUIRED');
      if(kind==='fd-close'&&held!.closing)throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_CLOSE_UNCONFIRMED');
      if(kind==='lock-release'&&!lockCleanup)throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_LOCK_REQUIRED');
      if((kind==='db-method'||kind==='db-close'||kind==='db-open-state'||kind==='db-exec'||kind==='db-transaction')&&!database)throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_DATABASE_REQUIRED');
      if(kind==='db-close'&&database!.closing)throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_DATABASE_UNCONFIRMED');
      if(kind==='db-close'&&state.pending.size){database!.deferred=true;this.#ownedSyncRaws.delete(reservation);return receiver;}
      if(kind==='fd-close'&&state.pending.size){held!.deferred=true;this.#ownedSyncRaws.delete(reservation);return undefined;}
      if(kind==='unlink-temp'){
        let temp:SyncTemp|undefined;const rows=state.temps.snapshot();for(let i=0;i<rows.length;i++)if(rows[i]!.path===args[0])temp=rows[i];
        if(!temp){this.#ownedSyncRaws.delete(reservation);return undefined;}
        if(state.pending.size){temp.deferred=true;this.#ownedSyncRaws.delete(reservation);return undefined;}
        if(method!==sdkUnlinkSync||!temp.identity)throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_TEMP_UNCONFIRMED');
        // The exact fd's original inode was recorded before it was closed.
        // Never remove a replacement at its former temp name.
        let current:any;const previous=state.tempProbe;state.tempProbe=temp.path;
        try{current=this.#sourceSyncSdk(key,'stat',sdkLstat,[temp.path,{bigint:true}]);this.#assertTempPathIdentity(state.context,temp,current);}catch(error){if(isNodeErrorCode(error,'ENOENT')&&!state.pending.size){state.temps.delete(temp);this.#unconfirmedSyncHandles.delete(temp);this.#ownedSyncRaws.delete(reservation);return undefined;}throw error;}finally{state.tempProbe=previous;}
      }
      if(kind==='stale-unlink'||kind==='lock-release'){
        if(kind==='stale-unlink'){
          let exclusive=false;for(let i=0;i<databases.length;i++)if(databases[i]!.exclusive)exclusive=true;
          if(!exclusive||state.deadPid===undefined||method!==sdkUnlinkSync||!state.lockPaths.has(args[0] as string))throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_RECOVERY_REQUIRED');
          state.context.assertCurrent();
        }
        // After the last Source callback, recheck the actual bytes and inode.
        // The second stat also detects replacement during the original read.
        const previous=state.finalReadPath;state.finalReadPath=args[0] as string;
        try{
          const before=this.#sourceSyncSdk(key,'stat',sdkLstat,[args[0],{bigint:true}]) as any;
          const bytes=this.#sourceSyncSdk(key,'string',sdkReadFileSync,[args[0],'utf8']);
          const after=this.#sourceSyncSdk(key,'stat',sdkLstat,[args[0],{bigint:true}]) as any;
          if(before.dev!==args[1]||before.ino!==args[2]||after.dev!==args[1]||after.ino!==args[2]||bytes!==args[3])throw new SdkError('session_save_locked');
        }finally{state.finalReadPath=previous;}
      }
      if(!state.cleaning&&!resourceCleanup&&!databaseCleanup&&!lockCleanup&&!tempProbe&&!tempIdentityOpen&&!finalRead&&kind!=='unlink-temp'&&kind!=='stale-unlink')state.context.assertCurrent();entered=true;
      if(kind==='rename-temp'){
        // After the last Source callback, inspect the actual source pathname.
        // Cleanup uses the same inode rule and cannot unlink a replacement.
        const previous=state.tempProbe;state.tempProbe=renamedTemp!.path;
        try{const current=this.#sourceSyncSdk(key,'stat',sdkLstat,[renamedTemp!.path,{bigint:true}]) as any;this.#assertTempPathIdentity(state.context,renamedTemp!,current);}
        finally{state.tempProbe=previous;}
      }
      if(kind==='fd-close')held!.closing=true;
      if(kind==='db-close')database!.closing=true;
      const raw=syncApply(method,receiver,kind==='stale-unlink'||kind==='lock-release'?[args[0]]:args);returned=true;
      syncDefine(reservation,'raw',{__proto__:null,value:raw} as PropertyDescriptor);
      let value:unknown=raw;
      if(kind==='stat'||kind==='fd-stat'){
        if(!raw||typeof raw!=='object'||syncIsProxy(raw)||syncIsPromise(raw)){this.#syncInventory(state,raw);throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_STAT_INVALID');}
        const rows=sdkDescriptors(raw),names=sdkKeys(rows),projection=sdkCreate(null);
        for(let i=0;i<names.length;i++){
          const name=names[i]!,row=rows[name as string]!;
          if(!sdkOwn(row,'value')){this.#retainPhysicalRaw(raw,state.context);this.#sourceSdkFailure??=sdkFailure(new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_STAT_INVALID'));continue;}
          if(row.value&&(typeof row.value==='object'||typeof row.value==='function')){
            if(sdkIsDate(row.value)&&!syncIsProxy(row.value)){const extra=sdkDescriptors(row.value),fields=sdkKeys(extra);for(let j=0;j<fields.length;j++){const child=extra[fields[j] as string]!;if(sdkOwn(child,'value'))this.#syncInventory(state,child.value);else{this.#retainPhysicalRaw(row.value,state.context);this.#sourceSdkFailure??=sdkFailure(new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_STAT_INVALID'));}}}
            else this.#syncInventory(state,row.value);
          }
          if(typeof name==='string'&&(typeof row.value==='number'||typeof row.value==='bigint'))syncDefine(projection,name,{__proto__:null,value:row.value} as PropertyDescriptor);
        }
        const bigint=(kind==='stat'||kind==='fd-stat')&&(args[1] as {bigint?:boolean}|undefined)?.bigint===true;
        const required=bigint?['mode','dev','ino','nlink','size','mtimeNs','ctimeNs']:['mode','dev','ino','nlink','size'];
        for(let i=0;i<required.length;i++){
          const name=required[i]!;
          if(!sdkOwn(projection,name)||(bigint?typeof projection[name]!=='bigint':typeof projection[name]!=='number'||!sdkInteger(projection[name])))throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_STAT_INVALID');
        }
        value=sdkFreeze(projection);
        if(kind==='fd-stat'&&held!.temp)held!.temp.identity={dev:projection.dev,ino:projection.ino};
      }else if(kind==='db-open'){
        if(!raw||typeof raw!=='object'||syncIsProxy(raw)||syncIsPromise(raw)){this.#syncInventory(state,raw);throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_DATABASE_INVALID');}
        const row:SyncDatabase={database:raw,closing:false,exclusive:false};state.databases.add(row);this.#holdPhysicalResource(row,state.context);
      }else if(kind==='db-exec'||kind==='db-close'){
        if(raw!==receiver){this.#syncInventory(state,raw);throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_DATABASE_INVALID');}
      }else if(kind==='callable'||kind==='db-method'){
        if(typeof raw!=='function'||syncIsProxy(raw)){this.#syncInventory(state,raw);throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_CALLABLE_INVALID');}
        if(kind==='db-method')database!.close=raw;
        const rows=sdkDescriptors(raw),names=sdkKeys(rows);for(let i=0;i<names.length;i++){const field=rows[names[i] as string]!;if(sdkOwn(field,'value')&&syncIsPromise(field.value))this.#syncRetain(state,field.value);}
      }else{
        if(raw&&typeof raw==='object'||typeof raw==='function')this.#syncInventory(state,raw);
        if(kind==='mkdir'?raw!==undefined&&typeof raw!=='string':kind==='string'||kind==='uuid'?typeof raw!=='string':kind==='void'||kind==='rename-temp'||kind==='link'||kind==='stale-unlink'||kind==='lock-release'||kind==='fd-close'||kind==='unlink-temp'?raw!==undefined:kind==='boolean'?typeof raw!=='boolean':kind==='db-open-state'?raw!==false:kind==='db-transaction'||kind==='pid-live'?raw!==true:kind==='fd-read'?typeof raw!=='number'||!sdkInteger(raw)||raw<0||raw>(args[3] as number):kind==='fd-open'||kind==='fd-open-read'||kind==='clock'?typeof raw!=='number'||!sdkInteger(raw)||raw<0:kind==='random'?typeof raw!=='number'||!sdkFinite(raw)||raw<0||raw>=1:true)throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_VALUE_INVALID');
      }
      if(kind==='fd-open-read'){const resource:SyncDescriptor={descriptor:value as number,closing:false};state.descriptors.add(resource);this.#holdPhysicalResource(resource,state.context);}
      if(kind==='fd-open'){
        const temp:SyncTemp={path:args[0] as string},resource:SyncDescriptor={descriptor:value as number,temp,closing:false};state.descriptors.add(resource);state.temps.add(temp);this.#holdPhysicalResource(resource,state.context);this.#holdPhysicalResource(temp,state.context);
      }
      if(kind==='fd-close'){state.descriptors.delete(held!);this.#unconfirmedSyncHandles.delete(held!);}
      if(kind==='rename-temp'){state.temps.delete(renamedTemp!);this.#unconfirmedSyncHandles.delete(renamedTemp!);}
      if(kind==='link')state.locks.add(args[1] as string);
      if(kind==='lock-release')state.locks.delete(args[0] as string);
      if(kind==='db-transaction')database!.exclusive=true;
      if(kind==='db-open-state'){state.databases.delete(database!);this.#unconfirmedSyncHandles.delete(database!);}
      if(kind==='unlink-temp'){const rows=state.temps.snapshot();for(let i=0;i<rows.length;i++)if(rows[i]!.path===args[0]){state.temps.delete(rows[i]!);this.#unconfirmedSyncHandles.delete(rows[i]);}}
      if(state.pending.size&&!(databaseCleanup&&kind==='db-method')||this.#sourceSdkFailure&&!resourceCleanup&&!databaseCleanup&&!lockCleanup&&!tempProbe&&!finalRead&&kind!=='unlink-temp')throw this.#sourceSdkFailure?.error??new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_UNCONFIRMED');
      this.#ownedSyncRaws.delete(reservation);if(!state.cleaning&&!resourceCleanup&&!databaseCleanup&&!lockCleanup&&!tempProbe&&!finalRead&&kind!=='unlink-temp'&&kind!=='stale-unlink'&&kind!=='fd-open'&&kind!=='fd-open-read'&&kind!=='db-open')state.context.assertCurrent();return value;
    }catch(error){
      if(entered){
        syncDefine(reservation,'failure',{__proto__:null,value:error} as PropertyDescriptor);
        const previousFailure=this.#sourceSdkFailure;
        this.#syncInventory(state,error);
        if(!previousFailure&&this.#sourceSdkFailure)this.#sourceSdkFailure=sdkFailure(error);
        if(!returned&&(kind==='stat'||kind==='fd-stat'||kind==='string'||kind==='boolean'||kind==='pid-live'&&isNodeErrorCode(error,'ESRCH')||kind==='link'&&isNodeErrorCode(error,'EEXIST')||kind==='fd-open'&&isNodeErrorCode(error,'EEXIST')||kind==='fd-open-read'&&isNodeErrorCode(error,'ENOENT'))&&sdkIsError(error)&&!state.pending.size&&!this.#sourceSdkFailure){if(kind==='pid-live')state.deadPid=args[0] as number;this.#ownedSyncRaws.delete(reservation);}
        else this.#sourceSdkFailure??=sdkFailure(error);
      }else this.#ownedSyncRaws.delete(reservation);
      throw error;
    }
  }
  #assertTempPathIdentity(context:SourceStoreContext,temp:SyncTemp,before:any):void{
    const identity=temp.identity;if(!identity)throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_TEMP_REQUIRED');
    if(before.dev===identity.dev&&before.ino===identity.ino)return;
    if(sdkPlatform!=='win32'||before.dev!==0n||before.ino!==identity.ino||!this.#statKind(before,'file',context)||this.#statKind(before,'symlink',context))throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_TEMP_REPLACED');
    // Windows path stats can omit the volume ID. Compare a separate original
    // read handle to the retained writer identity, without dropping dev/ino.
    // Every new raw and descriptor remains in the same Source custody owner.
    let probe:number|undefined,failure:{error:unknown}|undefined;
    try{
      probe=this.#sourceSyncSdk(context,'fd-open-read',sdkOpenSync,[temp.path,'r']) as number;
      const opened=this.#sourceSyncSdk(context,'fd-stat',sdkFstat,[probe,{bigint:true}]) as any;
      const after=this.#sourceSyncSdk(context,'stat',sdkLstat,[temp.path,{bigint:true}]) as any;
      if(opened.dev!==identity.dev||opened.ino!==identity.ino||!this.#statKind(opened,'file',context)||opened.mode!==before.mode||opened.size!==before.size)throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_TEMP_REPLACED');
      const fields=['dev','ino','mode','nlink','size','mtimeNs','ctimeNs'];
      for(let i=0;i<fields.length;i++)if(after[fields[i]!]!==before[fields[i]!])throw new SdkError('TASK_SNAPSHOT_SOURCE_SYNC_TEMP_REPLACED');
    }catch(error){failure=sdkFailure(error);}
    try{if(probe!==undefined)this.#sourceSyncSdk(context,'fd-close',sdkCloseSync,[probe]);}
    catch(error){if(!failure)throw error;const errors:unknown[]=[];appendIntrinsic(errors,failure.error);appendIntrinsic(errors,error);const combined=aggregateIntrinsicErrors(errors,'TASK_SNAPSHOT_SOURCE_SYNC_TEMP_PROBE_CLEANUP');syncDefine(combined,'cause',{__proto__:null,value:failure.error} as PropertyDescriptor);throw combined;}
    if(failure)throw failure.error;
  }
  #sourceStat(path:string,context?:SourceStoreContext,bigint=false):any{
    return context?this.#sourceSyncSdk(context,'stat',sdkLstat,[path,{bigint:true}]):bigint?lstatSync(path,{bigint:true}):lstatSync(path);
  }
  #statKind(stat:any,kind:'directory'|'file'|'symlink',context?:SourceStoreContext):boolean{
    if(!context)return kind==='directory'?stat.isDirectory():kind==='file'?stat.isFile():stat.isSymbolicLink();
    const mode=stat.mode,type=typeof mode==='bigint'?mode&0o170000n:mode&0o170000;
    return type===(typeof mode==='bigint'?(kind==='directory'?0o040000n:kind==='file'?0o100000n:0o120000n):(kind==='directory'?0o040000:kind==='file'?0o100000:0o120000));
  }

  async save(snapshot: TaskSnapshot, expectedPrevious?: TaskSnapshot): Promise<void> {
    const original: TaskSnapshot = JSON.parse(JSON.stringify(snapshot));
    const expected = expectedPrevious === undefined ? undefined : JSON.parse(JSON.stringify(expectedPrevious));
    await this.#enqueueWrite(original.taskId, (context) => this.#saveSerial(original, expected,undefined,context));
  }

  /** Permanently rejects new writes, then waits for accepted physical IO. */
  async closeAndDrain(): Promise<void> {return this.#closeAndDrain();}
  async #closeAndDrain():Promise<void> {
    this.#writerClosed = true;
    await this.#writerQueue;
    let physicalFailure:{error:unknown}|undefined;
    try{await this.#capturePhysicalCut().waitKnown();}catch(error){physicalFailure=sdkFailure(error);}
    if(this.#unconfirmedSyncHandles.size||this.#ownedSyncRaws.size)throw Error('TASK_SNAPSHOT_SYNC_CLOSE_UNCONFIRMED',{cause:this.#sourceSdkFailure?this.#sourceSdkFailure.error:this.#syncCloseFailure});
    if(physicalFailure)throw physicalFailure.error;
  }

  /** The same Store owns reservations, original raws and any visible child
   * tails. An invalid result is never converted into a healthy IO receipt. */
  async #sourceSdk(context:SourceStoreContext|undefined,kind:SourceSdkKind,method:Function,args:unknown[],receiver?:unknown):Promise<{value:unknown;failure?:{error:unknown}}>{
    let complete!:()=>void;const operation:StorePhysicalOperation={done:false,promise:new SyncPromise<void>(yes=>{complete=yes;}),resources:[],raws:[]};
    context??=this.#ordinaryContext();this.#physicalOperations.add(operation);this.#physicalJob(context)?.operations.push(operation);
    let workerBirth:ProtectionWorkerBirth|undefined;
    try{
      if(kind==='protection'&&method===readOriginalTaskObservationProtectionInWorker){
        if(receiver!==undefined||args.length!==2||args[0]!==this.#observations||typeof args[1]!=='string')throw new SdkError('TASK_STORE_PROTECTION_WORKER_CONTEXT_REQUIRED');
        const taskId=args[1],provider=this.#observations,source=readOriginalTaskObservationWorkerSource(provider,taskId);
        const ticket=sdkFreeze(sdkCreate(null));
        const assertLocal=()=>{if(!workerBirth?.active||operation.done||!this.#physicalOperations.has(operation)||workerBirth.provider!==this.#observations)throw new SdkError('TASK_STORE_PROTECTION_WORKER_CLOSED');source.assertLocal();};
        const assertCurrent=()=>{assertLocal();source.assertCurrent();assertLocal();};
        const view=sdkFreeze({pOnly:true as const,executionClass:'snapshot_prep' as const,taskId,parentRef:readCurrentOriginalRootExecutionContext(),assertCurrent,assertLocal});
        const request=sdkFreeze({workerKind:'protection_read' as const,entry:source.entry,options:source.options,assertCurrent,assertLocal});
        workerBirth={store:this,provider,taskId,operation,active:true,context:view,request};
        syncApply(sdkWeakSet,protectionWorkerBirths,[ticket,workerBirth]);args=[provider,taskId,ticket];
      }
      const result=await this.#sourceSdkOwned(context,kind,method,args,receiver,operation);if(kind==='resource')operation.resources.push(result.value);return result;
    }
    finally{if(workerBirth)workerBirth.active=false;operation.done=true;this.#physicalOperations.delete(operation);complete();}
  }
  async #sourceSdkOwned(context:SourceStoreContext|undefined,kind:SourceSdkKind,method:Function,args:unknown[],receiver:unknown,operation:StorePhysicalOperation):Promise<{value:unknown;failure?:{error:unknown}}>{
    context??=this.#ordinaryContext();
    const retain=(value:unknown)=>{this.#retainPhysicalRaw(value,context);operation.raws.push(value);};
    const hold=(value:unknown)=>{this.#holdPhysicalResource(value,context);operation.resources.push(value);};
    const reservation=sdkCreate(null);retain(reservation);
    const seen=createIntrinsicSet<object>();
    let unknown=false;const unknownKinds:string[]=[];
    const diagnosticKind=(value:unknown)=>{if(syncIsProxy(value))return 'proxy';if(syncIsPromise(value))return 'promise';if(typeof value==='function')return 'callable';const p=value&&typeof value==='object'?syncPrototype(value):undefined,c=p?syncDescriptor(p,'constructor'):undefined,n=c&&sdkOwn(c,'value')&&typeof c.value==='function'?syncDescriptor(c.value,'name'):undefined;return n&&sdkOwn(n,'value')&&['InProcessTaskRuntimeHost','Map','Set','AsyncLocalStorage','AsyncContextFrame','FileTaskSnapshotStore'].includes(n.value)?n.value:'opaque';};
    const scan=async(value:unknown,rootPromise=false):Promise<{error:unknown}|undefined>=>{
      const inventory=scanTaskStoreSdkChildren(value,rootPromise);
      for(let i=0;i<inventory.unknowns.length;i++){unknown=true;if(unknownKinds.length<8)unknownKinds.push(diagnosticKind(inventory.unknowns[i]));retain(inventory.unknowns[i]);}
      let failure:{error:unknown}|undefined;
      // Start every visible sibling before waiting for any of them.
      const work:Array<Promise<SourceSdkOutcome>>=[];
      for(let i=0;i<inventory.promises.length;i++){
        const child=observe(inventory.promises[i]);syncDefine(work,sdkString(work.length),{__proto__:null,value:child} as PropertyDescriptor);
      }
      for(let i=0;i<work.length;i++){const result=await work[i]!;if(result.failure&&!failure)failure=result.failure;if(result.unknown)unknown=true;}
      return failure;
    };
    const observe=(raw:unknown,resource=false):Promise<SourceSdkOutcome>=>{
      if(raw&&typeof raw==='object'&&seen.has(raw))return new SyncPromise(yes=>yes({__proto__:null,value:undefined,unknown:false,fulfilled:true} as SourceSdkOutcome));
      if(raw&&typeof raw==='object')seen.add(raw);
      retain(raw);
      const ownTails=scan(raw,true);
      const promise=new SyncPromise<SourceSdkOutcome>(yes=>{
        const complete=async(value:unknown,failed:boolean)=>{
          if(resource&&!failed)hold(value);
          let failure:{error:unknown}|undefined=failed?sdkFailure(value):undefined;
          try{
            const ownFailure=await ownTails;
            const childFailure=resource&&!failed?undefined:await scan(value);
            failure??=ownFailure??childFailure;
          }catch(error){unknown=true;failure??=sdkFailure(error);}
          if(!unknown)this.#ownedSyncRaws.delete(raw);
          yes({__proto__:null,value,failure,unknown,fulfilled:!failed} as SourceSdkOutcome);
        };
        try{if(!syncIsPromise(raw)||syncIsProxy(raw))throw new SdkError('TASK_SNAPSHOT_SYNC_SDK_UNCONFIRMED');assertStandardIpcPromise(raw,'TASK_SNAPSHOT_SOURCE_OBSERVER_UNKNOWN');syncApply(syncThen,raw,[(value:unknown)=>{void complete(value,false);},(error:unknown)=>{void complete(error,true);}]);}
        catch(error){unknown=true;void complete(error,true);}
      });
      syncDefine(promise,'constructor',{__proto__:null,value:SyncPromise} as PropertyDescriptor);return promise;
    };
    let result:SourceSdkOutcome;
    try{if(this.#sourceSdkFailure&&!context.cleanup)throw this.#sourceSdkFailure.error;context.assertCurrent();const raw=syncApply(method,receiver,args);result=kind==='fd'?{__proto__:null,value:raw,failure:await scan(raw),unknown,fulfilled:true} as SourceSdkOutcome:await observe(raw,kind==='resource');}
    catch(error){unknown=true;await scan(error);result={__proto__:null,value:undefined,failure:sdkFailure(error),unknown:true,fulfilled:false} as SourceSdkOutcome;}
    if(!unknown)this.#ownedSyncRaws.delete(reservation);
    else this.#sourceSdkFailure??=sdkFailure(result.failure?result.failure.error:new SdkError('TASK_SNAPSHOT_SOURCE_SDK_UNCONFIRMED'));
    if(kind==='resource'&&result.fulfilled&&result.value&&typeof result.value==='object'&&!syncIsProxy(result.value)){
      // Hand the actual acquired resource to its existing finally owner before
      // any Source guard can throw. A failed acquisition tail is carried too.
      const acquired=sdkBox(result.value) as {value:unknown;failure?:{error:unknown}};
      const failure=result.failure??(unknown?sdkFailure(new SdkError('TASK_SNAPSHOT_SOURCE_SDK_UNCONFIRMED')):undefined);
      if(failure)syncDefine(acquired,'failure',{__proto__:null,value:failure} as PropertyDescriptor);
      return acquired;
    }
    if(result.failure)throw result.failure.error;
    if(unknown)throw new SdkError('TASK_SNAPSHOT_SOURCE_SDK_UNCONFIRMED',{cause:{sdkKind:kind,unknownKinds}});
    const value=result.value;
    if(kind==='void'?value!==undefined:kind==='string'?typeof value!=='string':kind==='mkdir'?value!==undefined&&typeof value!=='string':kind==='fd'?value!==-1:kind==='names'?!Array.isArray(value)||value.some(name=>typeof name!=='string'||!name||/[\\/\0]/.test(name)):!value||typeof value!=='object'||syncIsProxy(value))throw new SdkError('TASK_SNAPSHOT_SOURCE_SDK_VALUE_INVALID');
    context.assertCurrent();return sdkBox(value);
  }

  async #sourceHandleMethod(context:SourceStoreContext,handle:object,name:'sync'|'close'):Promise<{value:Function}>{
    let current:object|null=handle;
    for(let depth=0;current&&depth<16;depth++){
      if(syncIsProxy(current))throw new SdkError('TASK_SNAPSHOT_SOURCE_METHOD_UNCONFIRMED');
      const row=syncDescriptor(current,name);
      if(row){
        if(!sdkOwn(row,'value'))throw new SdkError('TASK_SNAPSHOT_SOURCE_METHOD_UNCONFIRMED');
        const method=row.value;
        if(typeof method==='function'&&!syncIsProxy(method))return sdkBox(method);
        // The original slot may already contain a live raw. It is not a
        // callable method, but all visible tails still belong to this Store.
        await this.#sourceSdk(context,'void',()=>method,[]);
        throw new SdkError('TASK_SNAPSHOT_SOURCE_METHOD_UNCONFIRMED');
      }
      current=syncPrototype(current);
    }
    throw new SdkError('TASK_SNAPSHOT_SOURCE_METHOD_UNCONFIRMED');
  }

  /** User-only cooperative fence; it grants no all-writer or migration authority. */
  fenceKnownWriter(requestSource: 'user' | 'agent' | 'scheduler'): Promise<void> {
    const owner=knownTaskWriters.get(this);
    if(!owner||arguments.length!==1)return Promise.reject(Error('known_writer_fence_owner'));
    if(requestSource!=='user')return Promise.reject(Error('known_writer_fence_request_source'));
    if(!['darwin','linux'].includes(process.platform))return Promise.reject(Error('known_writer_fence_platform'));
    if(owner.pending)return owner.pending;
    this.#writerClosed=true;const accepted=this.#writerQueue;
    const work=Promise.resolve().then(async()=>{await accepted;const release=acquireSaveLock(join(this.#rootDir,'.task-store.save.lock'));try{owner.fence.persist();}finally{release();}});
    owner.pending=work;void work.then(()=>{if(owner.pending===work)owner.pending=undefined;},()=>{if(owner.pending===work)owner.pending=undefined;});return work;
  }

  #enqueueWrite<T>(taskId: string | undefined, action: (context:SourceStoreContext) => Promise<T>,context?:SourceStoreContext): Promise<T> {
    if (this.#writerClosed) return Promise.reject(Error('task_store_closed'));
    context??=this.#sourceContext(()=>{},'prepare');
    const job:StorePhysicalJob={done:false,operations:[],raws:[],resources:[]};this.#physicalJobs.add(job);syncApply(sdkWeakSet,this.#physicalContextJobs,[context,job]);
    const run = this.#writerQueue.then(async () => {
      try{
      assertOrdinarySourceWriterRoute();
      await this.#sourceSdk(context,'mkdir',sdkMkdir,[this.#rootDir,{recursive:true}]);
      const root = this.#sourceStat(this.#rootDir,context), resolved = context?this.#sourceSyncSdk(context,'string',sdkRealpath,[this.#rootDir]) as string:realpathSync(this.#rootDir);
      if (!this.#statKind(root,'directory',context) || this.#statKind(root,'symlink',context)) throw Error('task_store_identity_changed');
      const lockPath = join(this.#rootDir, '.task-store.save.lock');
      const release = acquireSaveLock(lockPath,context?.sync);
      const lock = this.#sourceStat(lockPath,context), bytes = context?this.#sourceSyncSdk(context,'string',sdkReadFileSync,[lockPath,'utf8']):readFileSync(lockPath, 'utf8');
      const assertCurrent = () => {
        const now = this.#sourceStat(this.#rootDir,context), current = this.#sourceStat(lockPath,context);
        if (now.dev !== root.dev || now.ino !== root.ino || this.#statKind(now,'symlink',context)
          || (context?this.#sourceSyncSdk(context,'string',sdkRealpath,[this.#rootDir]):realpathSync(this.#rootDir)) !== resolved || current.dev !== lock.dev || current.ino !== lock.ino
          || this.#statKind(current,'symlink',context) || (context?this.#sourceSyncSdk(context,'string',sdkReadFileSync,[lockPath,'utf8']):readFileSync(lockPath, 'utf8')) !== bytes) throw Error('task_store_identity_changed');
      };
      this.#assertWriterCurrent = assertCurrent;
      let failure: { error: unknown } | undefined;
      let settledBodyResult!: T;
      let settledBodyFailure: {
          error: unknown;
      } | undefined;
      try {
          try {
              assertCurrent();
              knownTaskWriters.get(this)!.fence.assertOpen();
              observeOrdinaryDirectoryWriter(resolved, 'task-root');
              assertOrdinarySourceWriterRoute();
              assertCurrent();
              // This admitted sequence retains the original Task lock across every
              // awaited write. Pending migration must acquire that same lock later.
              const result = await action(context!);
              assertCurrent();
              {
                  settledBodyResult = result;
              }
          }
          catch (error) {
              failure = { error };
              throw error;
          }
      }
      catch (error) {
          settledBodyFailure = { error };
      }
      {
          this.#assertWriterCurrent = undefined;
          // A renamed root may now expose an unrelated lock at the old path.
          // The original lock must remain for explicit recovery in that case.
          await this.#joinSourceSync(context);
          const syncState=context?this.#syncState(context):undefined;
          if(syncState)syncState.cleaning=true;
          try {
              assertCurrent();
              release();
          }
          catch (cleanupError) {
              if (failure)
                  throw new AggregateError([failure.error, cleanupError], 'task_store_identity_changed_or_release_failed', { cause: failure.error });
              throw cleanupError;
          }
          finally{if(syncState)syncState.cleaning=false;}
      }
      if (settledBodyFailure)
          throw settledBodyFailure.error;
      return settledBodyResult;
      }finally{await this.#joinSourceSync(context);}
    }).finally(()=>{job.done=true;this.#physicalJobs.delete(job);});
    const tracked = run.then(() => undefined, () => undefined);
    this.#writerQueue = tracked;
    if (taskId) {
      this.#taskWriteQueues.set(taskId, tracked);
      void tracked.then(() => { if (this.#taskWriteQueues.get(taskId) === tracked) this.#taskWriteQueues.delete(taskId); });
    }
    return run;
  }

  /** Main-only exact-write receipt; it grants no completion/verification authority. */
  async saveWithReceipt(snapshot: TaskSnapshot, expectedPrevious?: TaskSnapshot): Promise<TaskSnapshotWriteReceipt> {
    const original: TaskSnapshot = JSON.parse(JSON.stringify(snapshot));
    const expected: TaskSnapshot | undefined = expectedPrevious === undefined ? undefined : JSON.parse(JSON.stringify(expectedPrevious));
    return this.#enqueueWrite(original.taskId, async (context) => {
      await this.#saveSerial(original, expected,undefined,context);
      const committed = this.#cache.get(original.taskId);
      if (!committed) throw Error('task_snapshot_write_unconfirmed');
      return this.#syncCommittedWrite(committed,context);
    });

  }

  /** A Native SDK return is owned before classification. Invalid/unobservable
   * originals never become a positive sync or physical-close receipt. */
  #consumeSyncSdk(raw:unknown):Promise<{value:unknown}> {
    this.#retainPhysicalRaw(raw);
    if(!syncIsPromise(raw)||syncIsProxy(raw))return SyncPromise.reject(Error('TASK_SNAPSHOT_SYNC_SDK_UNCONFIRMED'));
    try{assertStandardIpcPromise(raw,'TASK_SNAPSHOT_SYNC_OBSERVER_UNKNOWN');}catch{return new SyncPromise(()=>{});}
    const result=new SyncPromise<{value:unknown}>((yes,no)=>{syncApply(syncThen,raw,[(value:unknown)=>{this.#ownedSyncRaws.delete(raw);yes(Object.assign(Object.create(null),{value}));},(error:unknown)=>{this.#ownedSyncRaws.delete(raw);no(error);}]);});
    syncDefine(result,'constructor',{__proto__:null,value:SyncPromise} as PropertyDescriptor);return result;
  }

  async #syncCommittedWrite(committed: CachedSnapshot,context?:SourceStoreContext):Promise<TaskSnapshotWriteReceipt> {
      context??=this.#ordinaryContext();
      if(this.#unconfirmedSyncHandles.size||this.#ownedSyncRaws.size)throw Error('TASK_SNAPSHOT_SYNC_CLOSE_UNCONFIRMED',{cause:this.#syncCloseFailure});
      // An earlier write may have persisted data but failed its index update.
      // A no-change retry must complete that original durable bookkeeping.
      await this.#syncIndexForTransition(undefined, committed.snapshot,context);
      const sync = async (path: string, optional = false) => {
        const flags=sdkPlatform==='win32'?'r+':'r';
        let handle:Awaited<ReturnType<typeof open>>;
        let acquisitionFailure:{error:unknown}|undefined;
        try {const acquired:{value:unknown;failure?:{error:unknown}}=await (context?this.#sourceSdk(context,'resource',sdkOpen,[path,flags]):this.#consumeSyncSdk(open(path,flags)));handle=acquired.value as typeof handle;acquisitionFailure=acquired.failure;}
        catch(error){if(optional&&(!context||!this.#sourceSdkFailure)&&isNodeErrorCode(error,'ENOENT'))return;throw error;}
        this.#holdPhysicalResource(handle);
        if(!handle||typeof handle!=='object'||syncIsProxy(handle))throw Error('TASK_SNAPSHOT_SYNC_SDK_UNCONFIRMED');
        const fdGetter=syncDescriptor(syncPrototype(handle),'fd')?.get;
        let syncFailure:{error:unknown}|undefined;
        try{
          if(acquisitionFailure)throw acquisitionFailure.error;
          context?.assertCurrent();
          const method=context?(await this.#sourceHandleMethod(context,handle,'sync')).value:handle.sync;if(typeof method!=='function'||syncIsProxy(method)){await this.#consumeSyncSdk(method);throw Error('TASK_SNAPSHOT_SYNC_SDK_UNCONFIRMED');}
          const value=(await (context?this.#sourceSdk(context,'void',method,[],handle):this.#consumeSyncSdk(syncApply(method,handle,[])))).value;
          if(value!==undefined)throw Error('TASK_SNAPSHOT_SYNC_SDK_UNCONFIRMED');
        }catch(error){syncFailure={error};}
        try{
          // Closing the actual acquired handle remains mandatory after Source
          // revocation; only its negative cleanup can run without that guard.
          const cleanupContext=context?sdkFreeze({__proto__:null,cleanup:true as const,assertCurrent(){}}):undefined;
          const method=cleanupContext?(await this.#sourceHandleMethod(cleanupContext,handle,'close')).value:handle.close;if(typeof method!=='function'||syncIsProxy(method)){await this.#consumeSyncSdk(method);throw Error('TASK_SNAPSHOT_SYNC_SDK_UNCONFIRMED');}
          const value=(await (cleanupContext?this.#sourceSdk(cleanupContext,'void',method,[],handle):this.#consumeSyncSdk(syncApply(method,handle,[])))).value;
          if(value!==undefined||typeof fdGetter!=='function'||syncIsProxy(fdGetter))throw Error('TASK_SNAPSHOT_SYNC_SDK_UNCONFIRMED');
          const descriptor=cleanupContext?(await this.#sourceSdk(cleanupContext,'fd',fdGetter,[],handle)).value:syncApply(fdGetter,handle,[]);if(descriptor!==-1){if(!context&&typeof descriptor!=='number')await this.#consumeSyncSdk(descriptor);throw Error('TASK_SNAPSHOT_SYNC_SDK_UNCONFIRMED');}
          this.#unconfirmedSyncHandles.delete(handle);
        }catch(error){this.#holdPhysicalResource(handle);this.#syncCloseFailure??=error;if(syncFailure)throw new AggregateError([syncFailure.error,error],'TASK_SNAPSHOT_SYNC_AND_CLOSE_FAILED',{cause:syncFailure.error});throw error;}
        if(syncFailure)throw syncFailure.error;
      };
      await sync(this.#snapshotPath(committed.snapshot.taskId));
      await sync(this.#journalPath(committed.snapshot.taskId), true);
      await sync(this.#snapshotDir());
      await sync(this.#indexPath());
      await sync(this.#rootDir);
      const facts = Object.freeze({ taskId: committed.snapshot.taskId, sessionId: committed.snapshot.sessionId,
        status: committed.snapshot.status, sequence: committed.sequence,
        snapshotDigest: createHash('sha256').update(JSON.stringify(committed.snapshot)).digest('hex') });
      const receipt = Object.freeze({}) as TaskSnapshotWriteReceipt;
      this.#assertWriterCurrent?.();
      writeReceipts.set(receipt, { store: this, facts });
      return receipt;
  }

  /** Internal opaque birth ticket only. The checkpoint is the sole prepare
   * index; no random retry identity or second journal is created. */
  async prepareDefaultDispatchSnapshot(ticket:unknown):Promise<{fact:NonNullable<TaskSnapshot['originalChildPreparation']>;receipt:TaskSnapshotWriteReceipt}> {return this.#prepareDefaultDispatchSnapshot(ticket);}
  async #prepareDefaultDispatchSnapshot(ticket:unknown):Promise<{fact:NonNullable<TaskSnapshot['originalChildPreparation']>;receipt:TaskSnapshotWriteReceipt}> {
    if(!knownTaskWriters.has(this))throw Error('DEFAULT_DISPATCH_PREPARATION_TICKET_REQUIRED');
    const birth=readOriginalChildPreparationTicket(ticket,this);
    const context=this.#sourceContext(birth.assertCurrent,'prepare');
    return this.#enqueueWrite(birth.marker.taskId,async()=>{
      const originalGuard=this.#assertWriterCurrent;
      this.#assertWriterCurrent=()=>{originalGuard?.();birth.assertCurrent();};
      try {
        const current=await this.#loadSnapshotState(birth.marker.taskId,undefined,context);
        this.#assertWriterCurrent();
        if(current){
          assertOriginalChildPreparationSnapshot(current.snapshot);
          assertOriginalChildPreparationInput(current.snapshot,birth.input);
          if(JSON.stringify(originalChildPreparationSourceData(current.snapshot.originalChildPreparation!))!==JSON.stringify(birth.marker))throw Error('DEFAULT_DISPATCH_PREPARATION_CONFLICT');
          this.#cache.set(birth.marker.taskId,current);
        }else{
          const built=await birth.build();this.#assertWriterCurrent();
          const candidate=JSON.parse(JSON.stringify(birth.capture(built))) as TaskSnapshot;
          assertOriginalChildPreparationInput(candidate,birth.input);
          candidate.originalChildPreparation={...JSON.parse(JSON.stringify(birth.marker)),preparedContentDigest:originalPreparedContentDigest(candidate,birth.marker.inputDigest)};
          if(candidate.status!=='understanding'||candidate.events.length!==2||candidate.events[0]?.type!=='task_started'||candidate.events[1]?.type!=='understanding_updated')throw Error('DEFAULT_DISPATCH_PREPARATION_INVALID');
          await this.#saveSerial(candidate,undefined,birth.marker,context);
        }
        const committed=this.#cache.get(birth.marker.taskId);if(!committed)throw Error('task_snapshot_write_unconfirmed');
        const receipt=await this.#syncCommittedWrite(committed,context);this.#assertWriterCurrent();
        return Object.freeze(Object.assign(Object.create(null),{fact:committed.snapshot.originalChildPreparation!,receipt}));
      }finally{this.#assertWriterCurrent=originalGuard;}
    },context);
  }

  /** Strict uncached read-cut metadata. No mkdir, lock creation, index repair,
   * cache resurrection, fsync or receipt. Absence grants no retry permission. */
  readDefaultDispatchPreparation(ticket:unknown):Promise<Readonly<NonNullable<TaskSnapshot['originalChildPreparation']>>|null> {return this.#readDefaultDispatchPreparation(ticket);}
  #readDefaultDispatchPreparation(ticket:unknown):Promise<Readonly<NonNullable<TaskSnapshot['originalChildPreparation']>>|null> {
    let observation:ReturnType<typeof readOriginalChildPreparationObservationTicket>;
    try{observation=readOriginalChildPreparationObservationTicket(ticket,this);}catch(error){return SyncPromise.reject(error);}
    if(this.#writerClosed)return SyncPromise.reject(Error('task_store_closed'));
    const context=this.#sourceContext(observation.assertCurrent,'observe');
    const run=syncApply(syncThen,this.#writerQueue,[async()=>{
      try{
      observation.assertCurrent();
      if(this.#unconfirmedSyncHandles.size||this.#ownedSyncRaws.size)throw Error('TASK_SNAPSHOT_SYNC_CLOSE_UNCONFIRMED',{cause:this.#syncCloseFailure});
      const taskId=observation.marker.taskId;
      const identity=(path:string,directory=false)=>{
        let stat;try{stat=this.#sourceStat(path,context,true);}catch(error){if(!this.#sourceSdkFailure&&isNodeErrorCode(error,'ENOENT'))return null;throw error;}
        if(this.#statKind(stat,'symlink',context)||(directory?!this.#statKind(stat,'directory',context):!this.#statKind(stat,'file',context)||stat.nlink!==1n))throw Error('DEFAULT_DISPATCH_PREPARATION_READ_UNCONFIRMED');
        return [stat.dev,stat.ino,stat.mode,stat.nlink,stat.size,stat.mtimeNs,stat.ctimeNs];
      };
      const cut=()=>{
        if(identity(join(this.#rootDir,'.task-store.save.lock')))throw Error('DEFAULT_DISPATCH_PREPARATION_READ_UNCONFIRMED');
        return [identity(this.#rootDir,true),identity(this.#snapshotDir(),true),identity(this.#snapshotPath(taskId)),identity(this.#journalPath(taskId))];
      };
      const before=cut();observation.assertCurrent();
      const read=async(path:string)=>{
        observation.assertCurrent();
        try{const value=(await this.#sourceSdk(context,'string',sdkReadFile,[path,'utf8'])).value;if(typeof value!=='string')throw Error('DEFAULT_DISPATCH_PREPARATION_READ_UNCONFIRMED');return value;}
        catch(error){if(!this.#sourceSdkFailure&&isNodeErrorCode(error,'ENOENT'))return null;throw error;}
      };
      const checkpointRaw=await read(this.#snapshotPath(taskId)),journalRaw=await read(this.#journalPath(taskId));
      if(!isDeepStrictEqual(before,cut()))throw Error('DEFAULT_DISPATCH_PREPARATION_READ_UNCONFIRMED');
      let fact:Readonly<NonNullable<TaskSnapshot['originalChildPreparation']>>|null=null;
      if(checkpointRaw===null){if(journalRaw!==null)throw Error('DEFAULT_DISPATCH_PREPARATION_READ_UNCONFIRMED');}
      else{
        // Original strict capture parser validates duplicate keys, checkpoint
        // sealing, journal anchors/gaps and partial tails; never repair them.
        readCapturedTaskHistory(checkpointRaw,journalRaw??'',taskId);
        const checkpoint=parseCheckpoint(checkpointRaw,true);
        if(!checkpoint.sealed)throw Error('DEFAULT_DISPATCH_PREPARATION_READ_UNCONFIRMED');
        const state=replayJournal(checkpoint,journalRaw??'',taskId);
        assertOriginalChildPreparationSnapshot(state.snapshot);
        assertOriginalChildPreparationInput(state.snapshot,observation.input);
        if(!state.snapshot.originalChildPreparation||!isDeepStrictEqual(originalChildPreparationSourceData(state.snapshot.originalChildPreparation),observation.marker))throw Error('DEFAULT_DISPATCH_PREPARATION_CONFLICT');
        fact=captureOriginalChildPreparation(state.snapshot.originalChildPreparation);
      }
      observation.assertCurrent();return fact;
      }finally{await this.#joinSourceSync(context);}
    }]) as Promise<Readonly<NonNullable<TaskSnapshot['originalChildPreparation']>>|null>;
    syncDefine(run,'constructor',{__proto__:null,value:SyncPromise} as PropertyDescriptor);
    this.#writerQueue=syncApply(syncThen,run,[()=>undefined,()=>undefined]);
    return run;
  }

  async getActiveTasks(): Promise<ActiveTaskRef[]> {
    const index = await this.#loadIndex();
    return index.activeTaskIds.map(taskId => ({ taskId }));
  }

  /** @deprecated Use getActiveTasks() — kept for backward compat */
  async getActiveTask(): Promise<ActiveTaskRef | null> {
    const tasks = await this.getActiveTasks();
    return tasks[0] ?? null;
  }

  async recoverTask(taskId: string, options?: TaskSnapshotReadOptions): Promise<TaskSnapshot | null> {
    options?.signal.throwIfAborted();
    const protection = await this.#readProtection(taskId, options);
    const protectedClosure = protection.closure;
    const pendingWrite = this.#taskWriteQueues.get(taskId);
    if (pendingWrite) await waitSnapshotRead(() => pendingWrite, options);
    options?.signal.throwIfAborted();
    const cached = this.#cache.get(taskId);
    if (cached) {
      if(cached.snapshot.taskId!==taskId)throw Error('task_snapshot_completion_owner');
      const protectedSnapshot = await this.#withProtection(cached.snapshot, options,protection);
      return waitSnapshotRead(() => observeTaskSnapshotCompletion(protectedSnapshot, taskId, options?.signal), options);
    }
    let loaded: CachedSnapshot | null;
    try { loaded = await this.#loadSnapshotState(taskId, options); }
    catch (cause) {
      if (protectedClosure || protection.executionProtected) throw Object.assign(new Error('SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE', { cause }), { code: 'SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE' });
      throw cause;
    }
    options?.signal.throwIfAborted();
    if (!loaded) {
      if (protectedClosure || protection.executionProtected) throw Object.assign(new Error('SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE'), { code: 'SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE' });
      return null;
    }
    if(loaded.snapshot.taskId!==taskId)throw Error('task_snapshot_completion_owner');
    const protectedSnapshot = await this.#withProtection(loaded.snapshot, options,protection);
    const observed = await waitSnapshotRead(() => observeTaskSnapshotCompletion(protectedSnapshot, taskId, options?.signal), options);
    options?.signal.throwIfAborted();
    this.#cache.set(taskId, loaded);
    return observed;
  }

  /** Uncached source reconstruction only. Never revives purged input from the
   * runtime cache, observes completion, repairs journals, or grants execution. */
  async readOriginalUserInput(taskId:string,options?:TaskSnapshotReadOptions):Promise<OriginalTaskUserInput|null>{
    const tails=new Set<Promise<unknown>>();
    const readOptions:TaskSnapshotReadOptions={signal:options?.signal??new AbortController().signal,trackPending(raw){tails.add(raw);options?.trackPending(raw);}};
    const consumed=new Map<Promise<unknown>,unknown>();sourceReadConsumptions.set(readOptions,consumed);
    let result:OriginalTaskUserInput|null=null,failure:{error:unknown}|undefined;
    try{
      readOptions.signal.throwIfAborted();
      if(typeof taskId!=='string'||!/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,255}$/.test(taskId))throw Error('task_original_input_invalid');
      let checkpoint;
      try{checkpoint=this.#sourceStat(this.#snapshotPath(taskId),this.#ordinaryContext());}catch(error){if(!isNodeErrorCode(error,'ENOENT'))throw error;}
      if(checkpoint){
        if(!this.#statKind(checkpoint,'file',this.#ordinaryContext())||this.#statKind(checkpoint,'symlink',this.#ordinaryContext())||checkpoint.nlink!==(typeof checkpoint.nlink==='bigint'?1n:1))throw Error('task_original_input_invalid');
        const initialProtection=await this.#readProtection(taskId,readOptions);
        const pendingWrite=this.#taskWriteQueues.get(taskId);if(pendingWrite)await waitSnapshotRead(()=>pendingWrite,readOptions);
        const loaded=await this.#loadSnapshotState(taskId,readOptions);
        if(loaded){
          if(loaded.snapshot.taskId!==taskId)throw Error('task_original_input_invalid');
          const snapshot=await this.#withProtection(loaded.snapshot,readOptions,initialProtection);
          readOptions.signal.throwIfAborted();
          const thread=snapshot.context?.threadId;
          if(snapshot.taskId!==taskId||typeof snapshot.sessionId!=='string'||!snapshot.sessionId||snapshot.sessionId.length>256
            ||typeof snapshot.prompt!=='string'||Buffer.byteLength(snapshot.prompt,'utf8')>65536
            ||thread!==undefined&&(typeof thread!=='string'||!thread||thread.length>256))throw Error('task_original_input_invalid');
          result={taskId:snapshot.taskId,sessionId:snapshot.sessionId,threadId:thread??null,prompt:snapshot.prompt,
            ...(snapshot.executionScope===undefined?{}:{executionScope:structuredClone(snapshot.executionScope)}),
            ...(snapshot.executionProtected?{executionProtected:true as const}:{}),...(snapshot.protectedObservationClosure?{protectedObservationClosure:structuredClone(snapshot.protectedObservationClosure)}:{})};
        }
      }
    }catch(error){failure={error};}
    // An abort wrapper may settle before the original fs/Worker promise. Hold
    // every admitted raw tail here, including errors arriving after the abort.
    const seen=new Set<Promise<unknown>>(),rawFailures:unknown[]=[];
    while([...tails].some(raw=>!seen.has(raw))){
      const batch=[...tails].filter(raw=>!seen.has(raw));for(const raw of batch)seen.add(raw);
      const outcomes=await Promise.allSettled(batch);for(let index=0;index<outcomes.length;index++){const outcome=outcomes[index]!;if(outcome.status==='rejected'&&!(consumed.has(batch[index]!)&&Object.is(consumed.get(batch[index]!),outcome.reason))&&!rawFailures.some(error=>Object.is(error,outcome.reason)))rawFailures.push(outcome.reason);}
    }
    sourceReadConsumptions.delete(readOptions);
    const failures=[...(failure?[failure.error]:[]),...rawFailures.filter(error=>!failure||!Object.is(error,failure.error))];
    if(failures.length>1)throw new AggregateError(failures,'task_original_input_read_unconfirmed',{cause:failures[0]});
    if(failures.length)throw failures[0];readOptions.signal.throwIfAborted();return result;
  }

  /** Read-only legacy ownership check, including terminal tasks absent from the active index. */
  async hasThreadHistory(threadId: string): Promise<boolean> {
    let directory: string[];
    const context=this.#ordinaryContext();
    try { directory = (await this.#sourceSdk(context,'names',sdkReaddir,[this.#snapshotDir()])).value as string[]; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    for (const name of directory) {
      if (!name.endsWith('.json')) continue;
      const entry=this.#sourceStat(join(this.#snapshotDir(),name),context);
      if (!this.#statKind(entry,'file',context) || this.#statKind(entry,'symlink',context)) throw new Error('task_history_owner_unknown');
      // One checkpoint at a time. Do not recover every task into the runtime's
      // snapshot cache or replay its history simply to establish ownership.
      const snapshot = parseCheckpoint((await this.#sourceSdk(context,'string',sdkReadFile,[join(this.#snapshotDir(),name),'utf8'])).value as string).snapshot;
      if (!snapshot || typeof snapshot.taskId !== 'string') throw new Error('task_history_owner_unknown');
      if (snapshot.context?.threadId === threadId) return true;
    }
    return false;
  }

  /** Main-only confirmation history; caller-supplied task lists are never authority. */
  async readPreviousUserTask(threadId: string, currentTaskId: string): Promise<TaskSnapshot | null> {
    const current = await this.recoverTask(currentTaskId);
    if (!current || current.context?.threadId !== threadId) return null;
    let latest: TaskSnapshot | null = null;
    let directory: string[];
    const context=this.#ordinaryContext();
    try { directory = (await this.#sourceSdk(context,'names',sdkReaddir,[this.#snapshotDir()])).value as string[]; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    for (const name of directory) {
      if (!name.endsWith('.json')) continue;
      const entry=this.#sourceStat(join(this.#snapshotDir(),name),context);
      if (!this.#statKind(entry,'file',context) || this.#statKind(entry,'symlink',context)) throw new Error('task_history_owner_unknown');
      const snapshot = parseCheckpoint((await this.#sourceSdk(context,'string',sdkReadFile,[join(this.#snapshotDir(),name),'utf8'])).value as string).snapshot;
      if (snapshot.taskId === currentTaskId || snapshot.context?.threadId !== threadId
        || snapshot.executionScope && (snapshot.executionScope.kind !== 'goal_turn' || snapshot.executionScope.origin !== 'user')) continue;
      if (snapshot.createdAt === current.createdAt) return null;
      if (snapshot.createdAt > current.createdAt) continue;
      if (!latest || snapshot.createdAt > latest.createdAt) latest = snapshot;
      else if (snapshot.createdAt === latest.createdAt) return null;
    }
    return latest ? this.recoverTask(latest.taskId) : null;
  }

  async clearActiveTask(taskId: string): Promise<void> {
    await this.#enqueueWrite(undefined, (context) => this.#updateIndex(index => {
      const ids = new Set(index.activeTaskIds);
      ids.delete(taskId);
      return { activeTaskIds: [...ids] };
    },context));
  }

  async #readProtection(taskId: string, options?: TaskSnapshotReadOptions,context?:SourceStoreContext) {
    const observed=context?(await this.#sourceSdk(context,'protection',sdkObservationRead,[taskId,context.sync],this.#observations)).value as {closure?:TaskSnapshot['protectedObservationClosure'];executionProtected?:true}:(await waitSnapshotRead(() => options?this.#sourceSdk(undefined,'protection',readOriginalTaskObservationProtectionInWorker,[this.#observations,taskId]):this.#sourceSdk(undefined,'protection',sdkObservationRead,[taskId],this.#observations),options)).value as {closure?:TaskSnapshot['protectedObservationClosure'];executionProtected?:true};
    return this.#rememberReadProtection(taskId,observed);
  }

  // Retain every accepted restriction, including checkpoint-only provenance.
  // This map can only narrow later reads; it never supplies missing source data.
  #rememberReadProtection(taskId:string,observed:{closure?:TaskSnapshot['protectedObservationClosure'];executionProtected?:true}) {
    const previous=this.#knownReadProtection.get(taskId),closure=mergeProtectedObservationClosures(previous?.closure,observed.closure);
    const protection={...(closure?{closure}:{}),...(previous?.executionProtected||observed.executionProtected?{executionProtected:true as const}:{})};
    if(closure||protection.executionProtected)this.#knownReadProtection.set(taskId,protection);return protection;
  }

  async #withProtection(snapshot: TaskSnapshot, options?: TaskSnapshotReadOptions,initial?:{closure?:TaskSnapshot['protectedObservationClosure'];executionProtected?:true},context?:SourceStoreContext): Promise<TaskSnapshot> {
    const protection = await this.#readProtection(snapshot.taskId, options,context);
    if (snapshot.executionProtected !== undefined && snapshot.executionProtected !== true) throw Error('SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE');
    const closure = mergeProtectedObservationClosures(mergeProtectedObservationClosures(initial?.closure,protection.closure), snapshot.protectedObservationClosure);
    const accepted=this.#rememberReadProtection(snapshot.taskId,{...(closure?{closure}:{}),...(initial?.executionProtected||protection.executionProtected||snapshot.executionProtected?{executionProtected:true as const}:{})});
    return { ...snapshot, ...(accepted.closure ? { protectedObservationClosure: accepted.closure } : {}),
      ...(accepted.executionProtected ? { executionProtected: true as const } : {}) };
  }

  async #saveSerial(snapshot: TaskSnapshot, expectedPrevious?: TaskSnapshot, birth?:TaskSnapshot['originalChildPreparation'],context?:SourceStoreContext): Promise<void> {
    context??=this.#ordinaryContext();
    if (snapshot.protectedObservationClosure) await this.#sourceSdk(context,'void',context?sdkObservationSave:this.#observations.save,[snapshot.taskId,snapshot.protectedObservationClosure,context?.sync],this.#observations);
    snapshot = withoutTaskCompletionObservation(await this.#withProtection(snapshot,undefined,undefined,context));
    await this.#sourceSdk(context,'mkdir',sdkMkdir,[this.#snapshotDir(),{recursive:true}]);
    const current = await this.#loadSnapshotState(snapshot.taskId,undefined,context);
    if (current) this.#cache.set(snapshot.taskId, current);
    else this.#cache.delete(snapshot.taskId);
    this.#assertWriterCurrent?.();
    assertOriginalChildPreparationTransition(current?.snapshot,snapshot,birth);
    if (!current) {
      await this.#writeCheckpoint(snapshot, 0,context);
      this.#cache.set(snapshot.taskId, { snapshot, sequence: 0, checkpointEventCount: snapshot.events.length, sealed: true });
      await this.#syncIndexForTransition(undefined, snapshot,context);
      return;
    }

    assertAppendOnlyEvents(current.snapshot, snapshot, expectedPrevious);
    if (!current.sealed) {
      // A journal must never coexist with an unsealed legacy checkpoint. Seal
      // the exact base aggregate first so an unsupported old-binary rewrite is
      // detected instead of replaying duplicate events.
      await this.#writeCheckpoint(current.snapshot, current.sequence,context);
      current.sealed = true;
    }
    const sequence = current.sequence + 1;
    const payload = buildJournalPayload(current, snapshot, sequence);
    if (payload.events.length === 0 && Object.keys(payload.patch).length === 0 && payload.removed.length === 0) {
      return;
    }
    const record: JournalRecord = { ...payload, checksum: checksumJournalPayload(payload) };
    const encodedRecord = `${JSON.stringify(record)}\n`;
    try {
      if (current.journalRepairOffset !== undefined) {
        await this.#sourceSdk(context,'void',sdkTruncate,[this.#journalPath(snapshot.taskId),current.journalRepairOffset]);
      }
    this.#assertWriterCurrent?.();
      await this.#sourceSdk(context,'void',sdkAppendFile,[this.#journalPath(snapshot.taskId),encodedRecord,'utf8']);
    } catch (error) {
      // A failed append may still leave a partial frame on disk. Force the next
      // operation to replay and truncate the tail instead of trusting memory.
      this.#cache.delete(snapshot.taskId);
      throw error;
    }
    this.#diagnostics.onWrite?.('journal', Buffer.byteLength(encodedRecord, 'utf8'));
    this.#cache.set(snapshot.taskId, {
      snapshot,
      sequence,
      checkpointEventCount: current.checkpointEventCount,
      sealed: true,
    });

    if (TERMINAL_STATUSES.has(snapshot.status) || shouldWriteInterimCheckpoint(current, snapshot, encodedRecord)) {
      // Checkpoint first, journal cleanup second. If cleanup is interrupted,
      // lastSequence makes replay ignore records already folded into checkpoint.
      await this.#writeCheckpoint(snapshot, sequence,context);
      await this.#sourceSdk(context,'void',sdkUnlink,[this.#journalPath(snapshot.taskId)]).catch((error) => {
        if ((context&&this.#sourceSdkFailure)||!isNodeErrorCode(error, 'ENOENT')) throw error;
      });
      this.#cache.set(snapshot.taskId, {
        snapshot,
        sequence,
        checkpointEventCount: snapshot.events.length,
        sealed: true,
      });
    }
    await this.#syncIndexForTransition(current.snapshot, snapshot,context);
  }

  async #loadSnapshotState(taskId: string, options?: TaskSnapshotReadOptions,context?:SourceStoreContext): Promise<CachedSnapshot | null> {
    let raw: string,checkpointRead:Promise<string>|undefined;
    try {
      raw = context?(await this.#sourceSdk(context,'string',sdkReadFile,[this.#snapshotPath(taskId),'utf8'])).value as string:await waitSnapshotRead(() => checkpointRead=this.#sourceSdk(undefined,'string',sdkReadFile,[this.#snapshotPath(taskId),'utf8']).then(result=>result.value as string), options);
    } catch (error) {
      options?.signal.throwIfAborted();
      if ((!context||!this.#sourceSdkFailure)&&isNodeErrorCode(error, 'ENOENT')){if(options&&checkpointRead)sourceReadConsumptions.get(options)?.set(checkpointRead,error);return null;}
      throw error;
    }
    options?.signal.throwIfAborted();
    const checkpoint = parseCheckpoint(raw);

    let journalRaw: string,journalRead:Promise<string>|undefined;
    try {
      journalRaw = context?(await this.#sourceSdk(context,'string',sdkReadFile,[this.#journalPath(taskId),'utf8'])).value as string:await waitSnapshotRead(() => journalRead=this.#sourceSdk(undefined,'string',sdkReadFile,[this.#journalPath(taskId),'utf8']).then(result=>result.value as string), options);
    } catch (error) {
      options?.signal.throwIfAborted();
      if ((!context||!this.#sourceSdkFailure)&&isNodeErrorCode(error, 'ENOENT')){if(options&&journalRead)sourceReadConsumptions.get(options)?.set(journalRead,error);return checkpoint;}
      throw error;
    }
    options?.signal.throwIfAborted();
    return replayJournal(checkpoint, journalRaw, taskId);
  }

  async #writeCheckpoint(snapshot: TaskSnapshot, lastSequence: number,context?:SourceStoreContext): Promise<void> {
    snapshot = withoutTaskCompletionObservation(snapshot);
    const target = this.#snapshotPath(snapshot.taskId);
    const tmp = this.#tempPath(target,context);
    const checkpoint = {
      ...snapshot,
      [CHECKPOINT_META_KEY]: {
        version: 1,
        lastSequence,
        checkpointEventCount: snapshot.events.length,
      } satisfies CheckpointPersistence,
    };
    const encoded = JSON.stringify(checkpoint, null, 2);
    this.#assertWriterCurrent?.();
    await this.#sourceSdk(context,'void',sdkWriteFile,[tmp,encoded,'utf8']);
    this.#assertWriterCurrent?.();
    await this.#sourceSdk(context,'void',sdkRename,[tmp,target]);
    this.#assertWriterCurrent?.();
    this.#diagnostics.onWrite?.('checkpoint', Buffer.byteLength(encoded, 'utf8'));
  }

  async #syncIndexForTransition(previous: TaskSnapshot | undefined, next: TaskSnapshot,context?:SourceStoreContext): Promise<void> {
    const wasActive = previous ? !TERMINAL_STATUSES.has(previous.status) : undefined;
    const isActive = !TERMINAL_STATUSES.has(next.status);
    if (wasActive === isActive) return;
    await this.#updateIndex(index => {
      const ids = new Set(index.activeTaskIds);
      if (isActive) ids.add(next.taskId);
      else ids.delete(next.taskId);
      return { activeTaskIds: [...ids] };
    },context);
  }

  async #updateIndex(mutator: (index: SnapshotIndex) => SnapshotIndex,context?:SourceStoreContext): Promise<void> {
    const run = this.#indexWriteQueue.then(async () => {
      const index = await this.#loadIndex(true,context);
      await this.#saveIndex(mutator(index),context);
    });
    this.#indexWriteQueue = run.catch(() => undefined);
    return run;
  }

  async #loadIndex(strict = false,context?:SourceStoreContext): Promise<SnapshotIndex> {
    try {
      const raw = (await this.#sourceSdk(context,'string',sdkReadFile,[this.#indexPath(),'utf8'])).value as string;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if ('activeTaskId' in parsed && !('activeTaskIds' in parsed)) {
        const old = parsed.activeTaskId as string | null;
        if (strict && old !== null && typeof old !== 'string') throw Error('task_store_index_invalid');
        return { activeTaskIds: old ? [old] : [] };
      }
      const ids = parsed.activeTaskIds;
      if (strict && (!Array.isArray(ids) || !ids.every(id => typeof id === 'string'))) throw Error('task_store_index_invalid');
      return { activeTaskIds: Array.isArray(ids) ? ids as string[] : [] };
    } catch (error) {
      if (strict && ((context&&this.#sourceSdkFailure)||!isNodeErrorCode(error, 'ENOENT'))) throw error;
      return { activeTaskIds: [] };
    }
  }

  async #saveIndex(index: SnapshotIndex,context?:SourceStoreContext): Promise<void> {
    await this.#sourceSdk(context,'mkdir',sdkMkdir,[this.#rootDir,{recursive:true}]);
    const target = this.#indexPath();
    const tmp = this.#tempPath(target,context);
    const encoded = JSON.stringify(index, null, 2);
    this.#assertWriterCurrent?.();
    await this.#sourceSdk(context,'void',sdkWriteFile,[tmp,encoded,'utf8']);
    this.#assertWriterCurrent?.();
    await this.#sourceSdk(context,'void',sdkRename,[tmp,target]);
    this.#assertWriterCurrent?.();
    this.#diagnostics.onWrite?.('index', Buffer.byteLength(encoded, 'utf8'));
  }

  #snapshotDir(): string { return join(this.#rootDir, 'snapshots'); }
  #snapshotPath(taskId: string): string { return join(this.#snapshotDir(), `${taskId}.json`); }
  #journalPath(taskId: string): string { return join(this.#snapshotDir(), `${taskId}.journal.jsonl`); }
  #indexPath(): string { return join(this.#rootDir, 'active-task.json'); }
  #tempPath(target: string,context?:SourceStoreContext): string {
    if(!context)return `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    const now=this.#sourceSyncSdk(context,'clock',sdkNow,[],sdkDate) as number,random=this.#sourceSyncSdk(context,'random',sdkRandom,[],sdkMath) as number;
    const suffix=syncApply(sdkSlice,syncApply(sdkNumberText,random,[36]),[2]) as string;
    return `${target}.${sdkPid}.${now}.${suffix}.tmp`;
  }
}

function waitSnapshotRead<T>(start: () => Promise<T>, options?: TaskSnapshotReadOptions): Promise<T> {
  if (!options) return start();
  const { signal, trackPending } = options;
  signal.throwIfAborted();
  const raw = start(); // Deliberately do not pass AbortSignal into the raw IO.
  trackPending(raw);
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    raw.then(value => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(signal.reason); else resolve(value);
    }, error => {
      signal.removeEventListener('abort', abort);
      reject(signal.aborted ? signal.reason : error);
    });
    // A synchronous tracker may observe cancellation while registering the raw
    // obligation. Never install a waiter which missed that cancellation.
    if (signal.aborted) abort();
  });
}

/**
 * Compatibility reader for synchronous call sites that previously parsed the
 * checkpoint JSON directly. New runtime paths should prefer recoverTask().
 */
export function recoverTaskSnapshotSync(rootDir: string, taskId: string): TaskSnapshot | null {
  const protection = new DesktopTaskObservationStore(rootDir).readProtectionSync(taskId);
  const protectedClosure = protection.closure;
  const protect=(snapshot:TaskSnapshot)=>{if(snapshot.taskId!==taskId)throw Error('task_snapshot_completion_owner');if(snapshot.executionProtected!==undefined&&snapshot.executionProtected!==true)throw Error('SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE');const closure=mergeProtectedObservationClosures(protectedClosure,snapshot.protectedObservationClosure);return {...snapshot,...(closure?{protectedObservationClosure:closure}:{}),...(protection.executionProtected||snapshot.executionProtected?{executionProtected:true as const}:{})};};
  let checkpointRaw: string;
  try {
    checkpointRaw = readFileSync(join(rootDir, 'snapshots', `${taskId}.json`), 'utf8');
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT') && !protectedClosure && !protection.executionProtected) return null;
    throw error;
  }
  const checkpoint = parseCheckpoint(checkpointRaw);
  try {
    const journalRaw = readFileSync(join(rootDir, 'snapshots', `${taskId}.journal.jsonl`), 'utf8');
    if (!checkpoint.sealed && journalRaw.length > 0) {
      throw new Error('unsealed checkpoint has a task journal');
    }
    return observeTaskSnapshotCompletionSync(protect(replayJournal(checkpoint, journalRaw, taskId).snapshot),taskId);
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return observeTaskSnapshotCompletionSync(protect(checkpoint.snapshot),taskId);
    throw error;
  }
}

function buildJournalPayload(current: CachedSnapshot, next: TaskSnapshot, sequence: number): JournalPayload {
  const patch: Record<string, unknown> = {};
  const removed: string[] = [];
  const previousRecord = current.snapshot as unknown as Record<string, unknown>;
  const nextRecord = next as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(previousRecord), ...Object.keys(nextRecord)]);
  keys.delete('taskId');
  keys.delete('events');
  for (const key of keys) {
    if (!(key in nextRecord)) {
      removed.push(key);
    } else if (JSON.stringify(previousRecord[key]) !== JSON.stringify(nextRecord[key])) {
      patch[key] = nextRecord[key];
    }
  }
  return {
    version: 1,
    taskId: next.taskId,
    sequence,
    previousSequence: current.sequence,
    events: next.events.slice(current.snapshot.events.length),
    patch,
    removed: removed.sort(),
  };
}

function applyJournalRecord(snapshot: TaskSnapshot, record: JournalRecord): TaskSnapshot {
  if(Object.hasOwn(record.patch,'originalChildPreparation')||record.removed.includes('originalChildPreparation'))throw Error('DEFAULT_DISPATCH_PREPARATION_IMMUTABLE');
  const next = {
    ...snapshot,
    ...record.patch,
    events: [...snapshot.events, ...record.events],
  } as TaskSnapshot & Record<string, unknown>;
  for (const key of record.removed) delete next[key];
  assertOriginalChildPreparationTransition(snapshot,next);
  return next;
}

const CAPTURED_TASK_FIELDS = new Set([
  'taskId', 'sessionId', 'status', 'prompt', 'materials', 'events', 'understanding', 'result',
  'salvage', 'context', 'executionScope', 'multiAgentPreparation', 'hostDelivery', 'usage',
  'createdAt', 'updatedAt', 'originalChildPreparation', 'executionProtected', 'protectedObservationClosure', 'currentCompletion',
]);
function capturedIdentity(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value)) throw Error('captured_task_session');
}
function capturedCore(value: TaskSnapshot): void {
  assertOriginalChildPreparationSnapshot(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !['understanding', 'running', 'waiting_user', 'completed', 'failed', 'cancelled'].includes(value.status)
    || typeof value.prompt !== 'string' || !Array.isArray(value.materials) || !Array.isArray(value.events)
    || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0
    || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < value.createdAt) throw Error('captured_task_checkpoint');
  capturedIdentity(value.taskId); capturedIdentity(value.sessionId);
}
/** JSON.parse has already checked syntax. Decode object keys before comparing
 * them, so escaped spellings cannot conceal an ambiguous duplicate. */
function capturedUniqueKeys(raw: string): void {
  assertCapturedJsonUniqueKeys(raw, 'captured_task_duplicate');
}

/** Narrow facts from captured bytes only. Actual full-source custody, retained
 * history and cross-owner relationships must be checked by the source collector. */
export function readCapturedTaskSessions(checkpointRaw: string, journalRaw: string, taskId: string): Readonly<{taskId: string; sessionIdentities: readonly string[]}> {
  return readCapturedTaskHistory(checkpointRaw,journalRaw,taskId);
}

/** Captured declarations only: references remain in their original namespace. */
export function readCapturedTaskDeclarations(checkpointRaw:string,journalRaw:string,taskId:string){
  const declarations=createCapturedTaskDeclarationAccumulator();
  const sessions=readCapturedTaskHistory(checkpointRaw,journalRaw,taskId,declarations);
  return declarations.finish(taskId,sessions.sessionIdentities);
}

function readCapturedTaskHistory(checkpointRaw:string,journalRaw:string,taskId:string,declarations?:ReturnType<typeof createCapturedTaskDeclarationAccumulator>):Readonly<{taskId:string;sessionIdentities:readonly string[]}>{
  if (typeof checkpointRaw !== 'string' || typeof journalRaw !== 'string') throw Error('captured_task_input');
  capturedIdentity(taskId);
  const checkpoint = parseCheckpoint(checkpointRaw, true);
  if (checkpoint.snapshot.taskId !== taskId) throw Error('captured_task_owner');
  declarations?.capture(checkpoint.snapshot,'checkpoint');
  if (journalRaw && !journalRaw.endsWith('\n')) throw Error('captured_task_tail');
  const sessions = new Set([checkpoint.snapshot.sessionId]);
  let firstSequence: number | undefined, previousSequence: number | undefined, oldSession: string | undefined;
  const result = replayJournal(checkpoint, journalRaw, taskId, record => {
    declarations?.capture({...record.patch,events:record.events},`journal[${record.sequence}]`);
    if (record.sequence !== record.previousSequence + 1
      || previousSequence !== undefined && record.previousSequence !== previousSequence) throw Error('captured_task_sequence');
    firstSequence ??= record.sequence; previousSequence = record.sequence;
    if (record.removed.includes('sessionId')) throw Error('captured_task_session');
    if (Object.hasOwn(record.patch, 'sessionId')) {
      const session = record.patch.sessionId; capturedIdentity(session); sessions.add(session);
      if (record.sequence <= checkpoint.sequence) oldSession = session;
    }
  });
  if (firstSequence !== undefined && firstSequence <= checkpoint.sequence && previousSequence! < checkpoint.sequence
    || oldSession !== undefined && oldSession !== checkpoint.snapshot.sessionId) throw Error('captured_task_anchor');
  capturedCore(result.snapshot);
  if (result.snapshot.taskId !== taskId) throw Error('captured_task_owner');
  sessions.add(result.snapshot.sessionId);
  declarations?.capture(result.snapshot,'final');
  return Object.freeze({taskId, sessionIdentities: Object.freeze([...sessions].sort())});
}

function parseCheckpoint(raw: string, captured = false): CachedSnapshot {
  const parsed = JSON.parse(raw) as TaskSnapshot & { [CHECKPOINT_META_KEY]?: CheckpointPersistence };
  assertOriginalChildPreparationSnapshot(parsed);
  if (captured) {
    capturedUniqueKeys(raw); capturedCore(parsed);
    if (Object.keys(parsed).some(key => key !== CHECKPOINT_META_KEY && !CAPTURED_TASK_FIELDS.has(key))) throw Error('captured_task_schema');
    if (Object.hasOwn(parsed, CHECKPOINT_META_KEY)) {
      const meta = parsed[CHECKPOINT_META_KEY];
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)
        || Object.keys(meta).sort().join(',') !== 'checkpointEventCount,lastSequence,version'
        || meta.version !== 1 || !Number.isSafeInteger(meta.lastSequence) || meta.lastSequence < 0
        || meta.checkpointEventCount !== parsed.events.length) throw Error('captured_task_checkpoint');
    }
  }
  const persistence = parsed[CHECKPOINT_META_KEY];
  delete parsed[CHECKPOINT_META_KEY];
  const sealed = persistence?.version === 1
    && Number.isSafeInteger(persistence.lastSequence)
    && persistence.lastSequence >= 0
    && Number.isSafeInteger(persistence.checkpointEventCount)
    && persistence.checkpointEventCount! >= 0;
  return {
    snapshot: parsed as TaskSnapshot,
    sequence: sealed
      ? persistence.lastSequence
      : 0,
    checkpointEventCount: sealed
      ? persistence.checkpointEventCount!
      : parsed.events.length,
    sealed,
  };
}

function replayJournal(checkpoint: CachedSnapshot, journalRaw: string, taskId: string, captureRecord?: (record: JournalRecord) => void): CachedSnapshot {
  if (!checkpoint.sealed && journalRaw.length > 0) {
    throw new Error('unsealed checkpoint has a task journal');
  }
  let { snapshot, sequence } = checkpoint;
  const terminated = journalRaw.endsWith('\n');
  const lines = journalRaw.split('\n');
  if (terminated) lines.pop();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      if (captureRecord && journalRaw) throw Error('captured_task_frame');
      continue;
    }
    if (!terminated && index === lines.length - 1) {
      // appendFile only commits newline-terminated frames. A final fragment,
      // even if parseable, is an unacknowledged crash tail.
      break;
    }
    const record = parseJournalRecord(line, taskId, index + 1);
    if (captureRecord) {
      capturedUniqueKeys(line);
      if (Object.keys(record).sort().join(',') !== 'checksum,events,patch,previousSequence,removed,sequence,taskId,version'
        || Array.isArray(record.patch)
        || [...Object.keys(record.patch), ...record.removed].some(key => !CAPTURED_TASK_FIELDS.has(key) || ['taskId', 'events', 'currentCompletion'].includes(key))) throw Error('captured_task_schema');
      captureRecord(record);
    }
    if (record.sequence <= sequence) continue;
    if (record.previousSequence !== sequence || record.sequence !== sequence + 1) {
      throw new Error(`task journal sequence gap at line ${index + 1}`);
    }
    snapshot = applyJournalRecord(snapshot, record);
    sequence = record.sequence;
  }
  return {
    snapshot,
    sequence,
    checkpointEventCount: checkpoint.checkpointEventCount,
    sealed: checkpoint.sealed,
    journalRepairOffset: terminated ? undefined : Math.max(0, journalRaw.lastIndexOf('\n') + 1),
  };
}

function shouldWriteInterimCheckpoint(
  current: CachedSnapshot,
  next: TaskSnapshot,
  encodedRecord: string,
): boolean {
  let nextEventThreshold = 256;
  while (nextEventThreshold <= current.checkpointEventCount) nextEventThreshold *= 2;
  return next.events.length >= nextEventThreshold || Buffer.byteLength(encodedRecord, 'utf8') >= 1_048_576;
}

function assertAppendOnlyEvents(previous: TaskSnapshot, next: TaskSnapshot, expectedPrevious?: TaskSnapshot): void {
  if (next.taskId !== previous.taskId || next.events.length < previous.events.length) {
    throw new Error('task events are not append-only');
  }
  if (
    expectedPrevious === previous
    && (previous.events.length === 0 || next.events[previous.events.length - 1] === previous.events.at(-1))
  ) {
    return;
  }
  for (let index = 0; index < previous.events.length; index += 1) {
    if (JSON.stringify(previous.events[index]) !== JSON.stringify(next.events[index])) {
      throw new Error('task events are not append-only');
    }
  }
}

function checksumJournalPayload(payload: JournalPayload): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function parseJournalRecord(line: string, taskId: string, lineNumber: number): JournalRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new Error(`invalid task journal record at line ${lineNumber}`, { cause: error });
  }
  if (!parsed || typeof parsed !== 'object') throw new Error(`invalid task journal record at line ${lineNumber}`);
  const record = parsed as Partial<JournalRecord>;
  const { checksum, ...payload } = record;
  if (
    record.version !== 1
    || record.taskId !== taskId
    || !Number.isSafeInteger(record.sequence)
    || record.sequence! <= 0
    || !Number.isSafeInteger(record.previousSequence)
    || record.previousSequence! < 0
    || !Array.isArray(record.events)
    || !record.patch
    || typeof record.patch !== 'object'
    || !Array.isArray(record.removed)
    || record.removed.some(key => typeof key !== 'string' || key === 'taskId' || key === 'events' || key === CHECKPOINT_META_KEY)
    || Object.keys(record.patch).some(key => key === 'taskId' || key === 'events' || key === CHECKPOINT_META_KEY)
    || typeof checksum !== 'string'
    || checksum !== checksumJournalPayload(payload as JournalPayload)
  ) {
    throw new Error(`invalid task journal record at line ${lineNumber}`);
  }
  return record as JournalRecord;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  if(!error||typeof error!=='object'||syncIsProxy(error))return false;
  const row=syncDescriptor(error,'code');
  return !!row&&sdkOwn(row,'value')&&row.value===code;
}
