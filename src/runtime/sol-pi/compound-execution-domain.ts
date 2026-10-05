import {constants,openSync,closeSync,fstatSync,readSync,lstatSync,mkdirSync,opendirSync,realpathSync,existsSync} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {writeFileAtomicallySync} from '../../utils/atomic-file.js';
import {getObservationSessionOwnerHostBinding,type ObservationSessionOwner} from './observation-session-owner.js';
import {assertSessionExecutionLease,type SessionExecutionLease,type SessionExecutionAuthority} from '../../ai/runtime/session-store/execution-authority.js';
import {getSessionExecutionAncestorLease} from '../../ai/runtime/session-store/execution-chain.js';

import {assertCompoundSourceInventoryCurrent,type CompoundSourceInventory} from './compound-source-inventory.js';
import {COMPOUND_DOMAIN_RESERVED_BYTES,reserveCompoundDomainBytes} from './compound-domain-budget.js';
import {acquireSaveLock} from '../../ai/runtime/session-store/mutation-lock.js';
import {holdCompoundDeletionCensus,readCompoundDeletionBytes} from '../../ai/runtime/session-store/compound-deletion-census.js';
import {toDurableSessionSnapshot,computeSessionHistoryDigest} from '../../ai/runtime/session-store/store.js';
import {readSessionAliases} from '../../ai/runtime/session-store/aliases.js';
export {COMPOUND_DOMAIN_RESERVED_BYTES} from './compound-domain-budget.js';
const INDEX_BYTES=256*1024;
export interface CompoundExecutionDomainBinding {
 readonly version:1;readonly sourceRoots:readonly string[];readonly sourceInventoryDigest:string;readonly authorityId:string;readonly profileRoot:string;readonly canonicalSessionId:string;
 readonly storeRoot:string;readonly workspaceRoot:string;readonly storeIdentity:string;readonly executionLockIdentity:string;readonly generation:number;readonly state:'active'|'retiring'|'retired';readonly initializationId:string;
}
interface DomainOwnerState {owner:ObservationSessionOwner;epoch:string;initializationId:string;closed:boolean;failed:boolean}
const domains=new WeakSet<object>();
export function getCompoundExecutionDomainBinding(domain: ReturnType<typeof openCompoundExecutionDomain>) {
 if(!domains.has(domain))throw Error("compound_domain_invalid");return domain.getBinding();
}
const domainOwners=new WeakMap<object,DomainOwnerState>();
const initializing=new WeakSet<object>();
function directoryIdentity(path:string):string{const stat=lstatSync(path,{bigint:true});if(!stat.isDirectory()||stat.isSymbolicLink())fail('root_changed');return `${stat.dev}:${stat.ino}`;}
function executionIdentity(root:string,sessionIdentity:string):string{
 const directory=join(root,'.session-execution'),dirIdentity=directoryIdentity(directory);
 const lock=join(directory,createHash('sha256').update(sessionIdentity.toLowerCase()).digest('hex')+'.sqlite');
 let file;try{file=lstatSync(lock,{bigint:true});}catch{fail('execution_lock_changed');}
 if(!file.isFile()||file.isSymbolicLink())fail('execution_lock_changed');
 return `${dirIdentity}:${file.dev}:${file.ino}`;
}
function fail(reason:string):never{throw Error(`compound_domain_${reason}`);}
function exact(value:unknown,keys:readonly string[]):asserts value is Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))fail('schema');
}
function readJson(path:string):unknown{
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const stat=fstatSync(fd);if(!stat.isFile()||stat.size>INDEX_BYTES||stat.mode&0o022)fail('file');
  const buffer=Buffer.alloc(INDEX_BYTES+1);let length=0;
  while(length<buffer.length){const n=readSync(fd,buffer,length,buffer.length-length,null);if(!n)break;length+=n;}
  if(length>INDEX_BYTES)fail('file_limit');return JSON.parse(buffer.subarray(0,length).toString('utf8'));
 }finally{closeSync(fd);}
}
function validateBinding(value:unknown):CompoundExecutionDomainBinding{
 exact(value,['version','sourceRoots','sourceInventoryDigest','authorityId','profileRoot','canonicalSessionId','storeRoot','workspaceRoot','storeIdentity','executionLockIdentity','generation','state','initializationId']);
 if(!Array.isArray(value.sourceRoots)||value.sourceRoots.length<1||value.sourceRoots.length>16||new Set(value.sourceRoots).size!==value.sourceRoots.length||value.sourceRoots.some(root=>typeof root!=='string'||!root||Buffer.byteLength(root)>4096||resolve(root)!==root)||typeof value.sourceInventoryDigest!=='string'||! /^[a-f0-9]{64}$/.test(value.sourceInventoryDigest))fail('schema');
 if(value.version!==1||!['active','retiring','retired'].includes(String(value.state))||!Number.isSafeInteger(value.generation)||Number(value.generation)<1||Number(value.generation)>128
  ||typeof value.canonicalSessionId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(value.canonicalSessionId))fail('schema');
 for(const key of ['authorityId','profileRoot','storeRoot','workspaceRoot','storeIdentity','executionLockIdentity','initializationId'])if(typeof value[key]!=='string'||!value[key]||Buffer.byteLength(value[key] as string)>4096)fail('schema');
 return structuredClone(value) as unknown as CompoundExecutionDomainBinding;
}
/** Metadata registration only. Actual factories must also validate live policy,
 * branch admission and final tool permission. This is not an OS isolation issuer.
 * The actual ObservationService already holds its exclusive profile owner lock. */
export function openCompoundExecutionDomain(input:{owner:ObservationSessionOwner;storeRoot:string;lease:SessionExecutionLease;inventory?:CompoundSourceInventory}){
 if(process.platform==='win32')fail('platform_not_qualified');
 const host=getObservationSessionOwnerHostBinding(input.owner),budget=host.service.getStorageBudget();
 if(budget.reservedBytes<COMPOUND_DOMAIN_RESERVED_BYTES)fail('budget_not_reserved');
 const profileRoot=realpathSync(budget.profileRoot),storeRoot=realpathSync(input.storeRoot);
 if(profileRoot!==budget.profileRoot||lstatSync(input.storeRoot).isSymbolicLink()||!lstatSync(storeRoot).isDirectory())fail('root');
 const session=host.session.exportSnapshot(),workspaceRoot=realpathSync(session.cwd),storeIdentity=directoryIdentity(storeRoot);
 try{assertSessionExecutionLease(input.lease,{root:storeRoot,sessionIdentity:session.sessionId});}catch{fail('root_lease_mismatch');}
 const executionLockIdentity=executionIdentity(storeRoot,session.sessionId);
 const directory=join(profileRoot,'compound-domains'),indexPath=join(directory,'index.json'),intentPath=join(directory,'initializing.json'),ownerPath=join(directory,'owner-state.json'),retiredPath=join(directory,'retired-generations.json');
 type Retired={generation:number;canonicalSessionId:string;initializationId:string;bindingHash:string;snapshotHash:string;treeSessionIds:string[]};
 const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const retiredRecords=():Retired[]=>{
  if(!existsSync(retiredPath))return [];
  const value=readJson(retiredPath);exact(value,['version','generations']);
  if(value.version!==1||!Array.isArray(value.generations)||value.generations.length>128)fail('retired_schema');
  const seen=new Set<string>();
  for(const [index,row] of value.generations.entries()){
   exact(row,['generation','canonicalSessionId','initializationId','bindingHash','snapshotHash','treeSessionIds']);
   if(row.generation!==index+1||typeof row.canonicalSessionId!=='string'||seen.has(row.canonicalSessionId)||typeof row.initializationId!=='string'||typeof row.bindingHash!=='string'||!/^[a-f0-9]{64}$/.test(row.bindingHash)||typeof row.snapshotHash!=='string'||!/^[a-f0-9]{64}$/.test(row.snapshotHash))fail('retired_schema');
   seen.add(row.canonicalSessionId);
   if(!Array.isArray(row.treeSessionIds)||row.treeSessionIds.length<1||row.treeSessionIds.length>256||new Set(row.treeSessionIds).size!==row.treeSessionIds.length||!row.treeSessionIds.includes(row.canonicalSessionId)||row.treeSessionIds.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(id)))fail('retired_schema');
  }
  return structuredClone(value.generations) as Retired[];
 };
 const checkIdentity=(closing=false)=>{
  if(directoryIdentity(storeRoot)!==storeIdentity)fail('root_changed');
  if(executionIdentity(storeRoot,session.sessionId)!==executionLockIdentity)fail('execution_lock_changed');
  const current=closing?host:getObservationSessionOwnerHostBinding(input.owner);
  if(current.service!==host.service||current.session!==host.session||current.service.authorityId!==host.service.authorityId
   ||current.session.exportSnapshot().sessionId!==session.sessionId||realpathSync(current.session.exportSnapshot().cwd)!==workspaceRoot)fail('owner_changed');
 };
 const census=()=>{
  if(lstatSync(directory).isSymbolicLink()||!lstatSync(directory).isDirectory()||realpathSync(directory)!==resolve(directory))fail('namespace');
  reserveCompoundDomainBytes(profileRoot,true);
 };
 const load=(closing=false)=>{
  checkIdentity(closing);census();
  const intent=readJson(intentPath);exact(intent,['version','sourceRoots','sourceInventoryDigest','authorityId','profileRoot','canonicalSessionId','storeRoot','workspaceRoot','storeIdentity','executionLockIdentity','generation','state','initializationId']);
  const value=validateBinding(readJson(indexPath));
  if(!isDeepStrictEqual(intent,{...value,state:'initializing'}))fail('initialization_mismatch');
  if(value.authorityId!==host.service.authorityId||value.profileRoot!==profileRoot||value.canonicalSessionId!==session.sessionId||value.storeRoot!==storeRoot||value.storeIdentity!==storeIdentity||value.executionLockIdentity!==executionLockIdentity||value.workspaceRoot!==workspaceRoot)fail('root_conflict');
  return value;
 };
 let ownerState=domainOwners.get(host.service),claimedThisCall=false;
 const readOwner=(value:CompoundExecutionDomainBinding)=>{
  const marker=readJson(ownerPath);exact(marker,['version','authorityId','initializationId','ownerEpoch','cleanShutdown']);
  if(marker.version!==1||marker.authorityId!==value.authorityId||marker.initializationId!==value.initializationId||typeof marker.ownerEpoch!=='string'||! /^[a-f0-9-]{36}$/.test(marker.ownerEpoch)||typeof marker.cleanShutdown!=='boolean')fail('owner_state');
  return marker;
 };
 const writeOwner=(cleanShutdown:boolean)=>{
  if(!ownerState)fail('owner_state');
  try{writeFileAtomicallySync(ownerPath,JSON.stringify({version:1,authorityId:host.service.authorityId,initializationId:ownerState.initializationId,ownerEpoch:ownerState.epoch,cleanShutdown}),{requireDirectorySync:true});}
  catch(error){ownerState.failed=true;throw error;}
 };
 const claim=(value:CompoundExecutionDomainBinding)=>{
  ownerState={owner:input.owner,epoch:randomUUID(),initializationId:value.initializationId,closed:false,failed:false};claimedThisCall=true;domainOwners.set(host.service,ownerState);writeOwner(false);
 };
 if(ownerState&&(ownerState.owner!==input.owner||ownerState.closed||ownerState.failed)){
  if(ownerState.failed||!ownerState.closed||!existsSync(indexPath)||validateBinding(readJson(indexPath)).state!=='retired')fail('owner_uncertain');
  ownerState=undefined;
 }
 if(initializing.has(host.service))fail('registration_reentrant');
 initializing.add(host.service);
 let binding:CompoundExecutionDomainBinding;
 try{
  if(!existsSync(directory)){
   if(!input.inventory)fail('inventory_required');
   const inventory=assertCompoundSourceInventoryCurrent(input.inventory);
   if(!inventory.roots.some(source=>existsSync(source)&&realpathSync(source)===storeRoot))fail('inventory_root_missing');
   if(inventory.snapshots.some(snapshot=>snapshot.executionProtected||snapshot.hasCompoundLedger||snapshot.hasSemanticLedger||snapshot.hasObservationClosure))fail('legacy_reconciliation_required');
   const ownLocks=join(storeRoot,'.session-execution'),ownLockName=createHash('sha256').update(session.sessionId.toLowerCase()).digest('hex')+'.sqlite';
   for(const entry of inventory.unclassifiedEntries){
    if(lstatSync(entry).isSymbolicLink()||realpathSync(entry)!==ownLocks)fail('inventory_unclassified');
    const handle=opendirSync(entry);
    try{
     let count=0,found=false;
     for(let lock=handle.readSync();lock;lock=handle.readSync()){
      if(++count>2||![ownLockName,ownLockName+'-journal'].includes(lock.name))fail('inventory_old_execution');
      const stat=lstatSync(join(entry,lock.name));if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)fail('inventory_old_execution');
      if(lock.name===ownLockName)found=true;
     }
     if(!found)fail('inventory_old_execution');
    }finally{handle.closeSync();}
   }
   assertSessionExecutionLease(input.lease,{root:storeRoot,sessionIdentity:session.sessionId});
   checkIdentity();mkdirSync(directory,{mode:0o700});
   const proposed:CompoundExecutionDomainBinding={version:1,sourceRoots:inventory.roots,sourceInventoryDigest:inventory.digest,authorityId:host.service.authorityId,profileRoot,canonicalSessionId:session.sessionId,storeRoot,workspaceRoot,storeIdentity,executionLockIdentity,generation:1,state:'active',initializationId:randomUUID()};
   validateBinding(proposed);const bytes=JSON.stringify(proposed);if(Buffer.byteLength(bytes)>INDEX_BYTES)fail('index_limit');
   claim(proposed);
   writeFileAtomicallySync(intentPath,JSON.stringify({...proposed,state:'initializing'}),{requireDirectorySync:true});
   writeFileAtomicallySync(indexPath,bytes,{requireDirectorySync:true});
  }
  const prior=validateBinding(readJson(indexPath));
  if(prior.state==='retired'){
   census();const records=retiredRecords(),last=records.at(-1),marker=readOwner(prior);
   if(!marker.cleanShutdown||prior.authorityId!==host.service.authorityId||prior.profileRoot!==profileRoot||prior.storeRoot!==storeRoot||prior.storeIdentity!==storeIdentity||!last||last.generation!==prior.generation||last.bindingHash!==hash(prior)||last.initializationId!==prior.initializationId)fail('retired_unconfirmed');
   if(prior.generation>=128||records.some(row=>row.canonicalSessionId===session.sessionId))fail('generation_limit');
   if(!input.inventory)fail('inventory_required');const inventory=assertCompoundSourceInventoryCurrent(input.inventory);
   if(!isDeepStrictEqual(inventory.roots,prior.sourceRoots))fail('inventory_changed');
   const retiredIds=new Set(records.flatMap(row=>row.treeSessionIds));
   if(retiredIds.has(session.sessionId))fail('generation_limit');
   if(inventory.snapshots.some(row=>row.hasUnsettledExecution||(row.executionProtected||row.hasCompoundLedger||row.hasSemanticLedger||row.hasObservationClosure)&&(row.root!==storeRoot||!retiredIds.has(row.sessionId))))fail('legacy_reconciliation_required');
   for(const row of readSessionAliases(storeRoot))if(!records.some(generation=>generation.generation===row.domainGeneration&&generation.initializationId===row.domainInitializationId&&generation.treeSessionIds.includes(row.targetSessionId)))fail('alias_unconfirmed');
   for(const entry of inventory.unclassifiedEntries){
    if(realpathSync(dirname(entry))!==storeRoot)fail('inventory_unclassified');
    const name=basename(entry);
    if(['.session-aliases.json','.session-aliases-enabled'].includes(name)){readSessionAliases(storeRoot);continue;}
    if(name!=='.session-execution'||lstatSync(entry).isSymbolicLink()||!lstatSync(entry).isDirectory())fail('inventory_unclassified');
    const expected=new Set([...retiredIds,session.sessionId].flatMap(id=>{const key=createHash('sha256').update(id.toLowerCase()).digest('hex')+'.sqlite';return [key,key+'-journal'];}));
    const locks=opendirSync(entry);let count=0;
    try{for(let item=locks.readSync();item;item=locks.readSync()){const stat=lstatSync(join(entry,item.name));if(++count>4096||!expected.has(item.name)||!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)fail('inventory_old_execution');}}finally{locks.closeSync();}
   }
   const proposed:CompoundExecutionDomainBinding={...prior,canonicalSessionId:session.sessionId,workspaceRoot,executionLockIdentity,generation:prior.generation+1,state:'active',initializationId:randomUUID(),sourceInventoryDigest:inventory.digest};
   validateBinding(proposed);reserveCompoundDomainBytes(profileRoot,true,Buffer.byteLength(JSON.stringify(proposed))*2);
   claim(proposed);writeFileAtomicallySync(intentPath,JSON.stringify({...proposed,state:'initializing'}),{requireDirectorySync:true});writeFileAtomicallySync(indexPath,JSON.stringify(proposed),{requireDirectorySync:true});
  }
  binding=load();
  const marker=readOwner(binding);
  if(!ownerState){if(!marker.cleanShutdown)fail('recovery_uncertain');claim(binding);}
  else if(marker.ownerEpoch!==ownerState.epoch||marker.cleanShutdown)fail('owner_uncertain');
 }catch(error){if(claimedThisCall&&ownerState)ownerState.failed=true;throw error;}
 finally{initializing.delete(host.service);}
 const activeOwner=ownerState!;
 const assertMetadataCurrent=()=>{
  if(activeOwner.closed||activeOwner.failed)fail('owner_uncertain');
  if(!isDeepStrictEqual(load(true),binding))fail('generation_changed');
  const marker=readOwner(binding);if(marker.ownerEpoch!==activeOwner.epoch||marker.cleanShutdown)fail('owner_uncertain');
 };
 const assertCurrent=()=>{input.owner.assertSession(host.session);assertMetadataCurrent();if(binding.state!=='active')fail('retiring');};
 let retirement:Promise<Readonly<CompoundExecutionDomainBinding>>|undefined;
 const domain=Object.freeze({getBinding(){assertMetadataCurrent();const copy=structuredClone(binding);Object.freeze(copy.sourceRoots);return Object.freeze(copy);},assertCurrent,
  retiredSessionIdentities(lease:SessionExecutionLease){
   assertSessionExecutionLease(lease,{root:storeRoot,sessionIdentity:session.sessionId});assertCurrent();
   return Object.freeze(retiredRecords().flatMap(record=>record.treeSessionIds));
  },
  beginRetirement(lease:SessionExecutionLease){
   assertSessionExecutionLease(lease,{root:binding.storeRoot,sessionIdentity:binding.canonicalSessionId});
   assertMetadataCurrent();if(binding.state==='retiring')return;
   const next:CompoundExecutionDomainBinding={...binding,state:'retiring'};
   try{writeFileAtomicallySync(indexPath,JSON.stringify(next),{requireDirectorySync:true});binding=next;}
   catch(error){activeOwner.failed=true;throw error;}
  },
  /** Called only by the host fresh-task/explicit retirement path. The real
   * owner transport is cancelled and drained outside the shared effects lock;
   * durable terminal tree facts are checked under that lock before retirement. */
  retire({authority}:{authority:SessionExecutionAuthority}):Promise<Readonly<CompoundExecutionDomainBinding>>{
   if(retirement)return retirement;
   input.owner.dispose();
   retirement=(async()=>{
    const fence=await authority.acquire({invocationId:`domain-retiring:${randomUUID()}`,kind:'recovery'});
    try{domain.beginRetirement(fence);}finally{await fence.releaseAfterDrain();}
    await host.drainTransport();
    const lease=await authority.acquire({invocationId:`domain-retired:${randomUUID()}`,kind:'recovery'});
    try{
     assertSessionExecutionLease(lease,{root:storeRoot,sessionIdentity:session.sessionId});assertMetadataCurrent();
     const release=acquireSaveLock(join(storeRoot,'.session-store-lock'));let releaseTree:(()=>void)|undefined;
     try{
      const bytes=readCompoundDeletionBytes(join(storeRoot,`${session.sessionId}.json`)),snapshot=toDurableSessionSnapshot(JSON.parse(bytes.toString('utf8')));
      if(snapshot.sessionId!==session.sessionId||!snapshot.executionProtected||snapshot.historyDigest!==computeSessionHistoryDigest(snapshot))fail('terminal_snapshot');
      const census=holdCompoundDeletionCensus(storeRoot,snapshot,bytes.length);releaseTree=census;
      const next:CompoundExecutionDomainBinding={...binding,state:'retired'},records=retiredRecords();
      if(records.length!==binding.generation-1)fail('retired_unconfirmed');
      records.push({generation:binding.generation,canonicalSessionId:binding.canonicalSessionId,initializationId:binding.initializationId,bindingHash:hash(next),snapshotHash:createHash('sha256').update(bytes).digest('hex'),treeSessionIds:[...census.sessionIds]});
      const data=JSON.stringify({version:1,generations:records});if(Buffer.byteLength(data)>128*1024)fail('generation_limit');reserveCompoundDomainBytes(profileRoot,true,Buffer.byteLength(data));
      try{writeFileAtomicallySync(retiredPath,data,{requireDirectorySync:true});writeFileAtomicallySync(indexPath,JSON.stringify(next),{requireDirectorySync:true});binding=next;writeOwner(true);activeOwner.closed=true;}
      catch(error){activeOwner.failed=true;throw error;}
      return Object.freeze(structuredClone(next));
     }finally{try{releaseTree?.();}finally{release();}}
    }finally{await lease.releaseAfterDrain();}
   })();
   const attempt=retirement;
   // A pending tree may later publish its real terminal facts. Rechecking those
   // facts repeats no native effect; a durability failure stays latched closed.
   void attempt.catch(()=>{if(retirement===attempt&&!activeOwner.failed)retirement=undefined;});
   return attempt;
  },
  /** Confirms metadata only. Caller still owes independent native/provider drain. */
  close(lease:SessionExecutionLease){
   if(activeOwner.closed)return;activeOwner.closed=true;
   try{
    assertSessionExecutionLease(lease,{root:binding.storeRoot,sessionIdentity:binding.canonicalSessionId});
    checkIdentity(true);if(activeOwner.failed)return;
    if(!isDeepStrictEqual(load(true),binding))fail('generation_changed');
    const marker=readOwner(binding);if(marker.ownerEpoch!==activeOwner.epoch||marker.cleanShutdown)fail('owner_uncertain');
    writeOwner(true);
   }catch(error){activeOwner.failed=true;throw error;}
  },
  assertForEffect(lease:SessionExecutionLease){
   const target={root:binding.storeRoot,sessionIdentity:binding.canonicalSessionId};
   let ancestor:SessionExecutionLease;
   try{assertSessionExecutionLease(lease,target);ancestor=lease;}catch{ancestor=getSessionExecutionAncestorLease(lease,target);}
   assertSessionExecutionLease(ancestor,target);assertCurrent();
  },
 });
 domains.add(domain);return domain;
}
