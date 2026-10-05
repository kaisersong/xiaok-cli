import {getManagedTurnDispatch} from '../../../runtime/sol-pi/compound-managed-turn.js';
import {validateSemanticCompactionLedger} from '../../../runtime/sol-pi/semantic-compaction-ledger.js';
import {constants,openSync,closeSync,fstatSync,readSync,realpathSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {validateCompoundOperationLedger,type CompoundOperationLedger} from '../../../runtime/sol-pi/compound-operation.js';
import {acquireSessionStoreExecutionGuard} from './execution-authority.js';
const MAX_BYTES=16*1024*1024,MAX_SESSIONS=256;
function fail(reason:string):never{throw Error(`session_delete_compound_${reason}`);}
export function createCompoundDeletionBudget(initialBytes=0){
 let remaining=MAX_BYTES-initialBytes,entries=0;
 if(remaining<0)fail('budget');
 const visit=(_path:string)=>{if(++entries>4096)fail('entry_budget');};
 return Object.freeze({visit,read(path:string){visit(path);const bytes=readCompoundDeletionBytes(path,remaining);remaining-=bytes.length;return bytes;}});
}
export type CompoundDeletionBudget=ReturnType<typeof createCompoundDeletionBudget>;

export function readCompoundDeletionBytes(file:string,remaining=MAX_BYTES):Buffer {
 const before=lstatSync(file,{bigint:true});
 if(!before.isFile()||before.isSymbolicLink()||before.size>BigInt(remaining))fail('budget');
 const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const stat=fstatSync(fd);if(!stat.isFile()||stat.size>remaining)fail('budget');
  const opened=fstatSync(fd,{bigint:true});if(opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size||opened.mtimeNs!==before.mtimeNs)fail('changed');
  const bytes=Buffer.alloc(stat.size+1);let size=0;
  while(size<bytes.length){const n=readSync(fd,bytes,size,bytes.length-size,null);if(!n)break;size+=n;}
  const after=fstatSync(fd,{bigint:true}),path=lstatSync(file,{bigint:true});
  if(size!==stat.size||size>remaining||after.size!==before.size||after.mtimeNs!==before.mtimeNs||path.dev!==before.dev||path.ino!==before.ino||path.size!==before.size||path.mtimeNs!==before.mtimeNs)fail('changed');return bytes.subarray(0,size);
 }finally{closeSync(fd);}
}
/** Called under the existing root mutation + target execution guard. Keeps
 * descendant execution guards until the caller's receipt/delete transaction
 * ends. This authenticates no new execution or physical-stop receipt. */
export function holdCompoundDeletionCensus(root:string,initial:{sessionId:string;compoundOperations?:unknown;semanticCompaction?:unknown},initialBytes:number,budget=createCompoundDeletionBudget(initialBytes)):(()=>void)&{readonly sessionIds:readonly string[]} {
 const inspectSemantic=(value:unknown)=>{if(value!==undefined&&validateSemanticCompactionLedger(value).reservations.some(row=>!['settled','cancelled_before_dispatch'].includes(row.status)))throw Error('session_delete_semantic_unsettled');};
 inspectSemantic(initial.semanticCompaction);
 if(initial.compoundOperations===undefined)return Object.assign(()=>{},{sessionIds:Object.freeze([initial.sessionId])});
 budget.visit(join(root,`${initial.sessionId}.json`));
 const releases:Array<()=>void>=[],ledgers=new Map<string,CompoundOperationLedger>();
 const release=()=>{for(const close of releases.splice(0).reverse())close();};
 const inspect=(id:string,value:unknown)=>{
  const ledger=validateCompoundOperationLedger(value);
  if(ledger.managedTurns?.records.some(row=>!['drained','cancelled_before_activation'].includes(row.state))||ledger.operations.some(r=>r.stage!=='settled')||ledger.directOperations?.some(r=>r.stage!=='settled')||ledger.providerAttempts?.some(r=>!['drained','cancelled_before_send'].includes(r.transportState)))fail('unsettled');
  ledgers.set(id,ledger);return ledger;
 };
 try{
  let layer=[initial.sessionId];inspect(initial.sessionId,initial.compoundOperations);
  while(layer.length){
   const children:string[]=[];
   for(const parent of layer.sort())for(const row of ledgers.get(parent)!.directOperations??[]){
    if(!row.delegation)continue;
    if(row.delegation.state!=='closed'||row.delegation.childPhase!=='drained')fail('child_unsettled');
    const id=row.delegation.childSessionIdentity;
    if(realpathSync(row.delegation.childStoreRoot)!==realpathSync(root)||ledgers.has(id)||children.includes(id))fail('child_identity');
    children.push(id);
   }
   for(const id of children.sort()){
    if(ledgers.size>=MAX_SESSIONS||!/^[A-Za-z0-9_-]{1,160}$/.test(id))fail('child_limit');
    releases.push(acquireSessionStoreExecutionGuard(root,id,undefined,true));
    const bytes=budget.read(join(root,`${id}.json`));
    const value=JSON.parse(bytes.toString('utf8'));
    if(value.schemaVersion!==1||value.sessionId!==id||!value.executionProtected||!value.compoundOperations)fail('child_missing');
    inspectSemantic(value.semanticCompaction);inspect(id,value.compoundOperations);
   }
   layer=children;
  }
  for(const [sessionId,ledger] of ledgers){
   if(!ledger.treeBudget)continue;
   if(ledger.treeBudget.rootSessionIdentity!==sessionId)fail('tree_identity');
   for(const allocation of ledger.treeBudget.allocations){
    if(allocation.state==='tombstone')continue;
    if(allocation.recordKind==='delegation'){
     const rows=[...ledgers.values()].flatMap(value=>value.directOperations??[]);
     const match=rows.find(row=>row.delegation?.childSessionIdentity===allocation.dispatch.sessionIdentity&&allocation.dispatch.hostProviderInvocationId===`child:${row.id}`&&allocation.dispatch.originalToolUseId===row.id&&row.finalInputHash===allocation.inputHash);
     if(!match||match.stage!=='settled'||match.delegation!.state!=='closed'||match.delegation!.childPhase!=='drained')fail('allocation_unconfirmed');
    }else if(allocation.recordKind==='turn'){
     const target=ledgers.get(allocation.dispatch.sessionIdentity),match=target?.managedTurns?.records.find(row=>isDeepStrictEqual(getManagedTurnDispatch(row),allocation.dispatch)&&row.inputHash===allocation.inputHash);
     if(!match||!['drained','cancelled_before_activation'].includes(match.state))fail('allocation_unconfirmed');
    }else{
     const target=ledgers.get(allocation.dispatch.sessionIdentity);if(!target)fail('allocation_missing');
     const records=[...target.operations,...(target.directOperations??[]),...(target.providerAttempts??[]),...target.tombstones];
     const match=records.find(row=>isDeepStrictEqual(row.dispatch,allocation.dispatch)&&row.inputHash===allocation.inputHash);
     if(!match||((allocation.recordKind==='provider')!==('transportState'in match||'providerAttempt'in match)))fail('allocation_unconfirmed');
    }
   }
  }
  return Object.assign(release,{sessionIds:Object.freeze([...ledgers.keys()].sort())});
 }catch(error){release();throw error;}
}
