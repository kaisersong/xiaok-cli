import {constants,openSync,closeSync,fstatSync,readSync,lstatSync,opendirSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {validateCompoundOperationLedger} from './compound-operation.js';
import {validateSemanticCompactionLedger} from './semantic-compaction-ledger.js';
import {computeSessionHistoryDigest} from '../../ai/runtime/session-store/store.js';
import {readSessionAliases} from '../../ai/runtime/session-store/aliases.js';

const LIMITS=Object.freeze({roots:16,entries:4096,bytes:64*1024*1024,fileBytes:16*1024*1024});
function fail(reason:string):never{throw Error(`compound_inventory_${reason}`);}
declare const inventoryBrand:unique symbol;
export interface CompoundSourceInventory {readonly [inventoryBrand]:true}
const inventories=new WeakMap<object,{assertUnchanged():void;facts:Readonly<{roots:readonly string[];snapshots:readonly Readonly<{root:string;sessionId:string;executionProtected:boolean;hasCompoundLedger:boolean;hasSemanticLedger:boolean;hasObservationClosure:boolean;hasUnsettledExecution:boolean}>[];unclassifiedEntries:readonly string[];digest:string}>}>();
export function assertCompoundSourceInventoryCurrent(value:CompoundSourceInventory){
 const entry=inventories.get(value);if(!entry)fail('invalid_capability');entry.assertUnchanged();return entry.facts;
}
/** Read-only evidence. It neither proves process drain nor permits initialization.
 * Product hosts must supply their complete fixed/registered source-root census;
 * any unclassified entry requires explicit reconciliation, never omission. */
export function inspectCompoundSourceInventory(sourceRoots:readonly string[]){
 if(!Array.isArray(sourceRoots)||sourceRoots.length>LIMITS.roots||!sourceRoots.length)fail('root_limit');
 const roots=[...new Set(sourceRoots.map(root=>{if(typeof root!=='string'||!root||Buffer.byteLength(root)>4096)fail('root');return resolve(root);} ))];
 function scan(){
  let bytesRead=0,entriesRead=0;
  const snapshots:Array<Readonly<{root:string;sessionId:string;fileHash:string;executionProtected:boolean;hasCompoundLedger:boolean;hasSemanticLedger:boolean;hasObservationClosure:boolean;hasUnsettledExecution:boolean}>>=[];
  const unclassifiedEntries:string[]=[];const identities:unknown[]=[];
  for(const root of roots){
   let rootStat;try{rootStat=lstatSync(root,{bigint:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){identities.push([root,'absent']);continue;}throw error;}
   if(!rootStat.isDirectory()||rootStat.isSymbolicLink())fail('unsafe_root');
   const canonical=realpathSync(root),directory=opendirSync(root),names:string[]=[];
   try{for(let entry=directory.readSync();entry;entry=directory.readSync()){if(++entriesRead>LIMITS.entries)fail('entry_limit');names.push(entry.name);}}finally{directory.closeSync();}
   names.sort();identities.push([root,canonical,String(rootStat.dev),String(rootStat.ino),names]);
   for(const name of names){
    const path=join(root,name),stat=lstatSync(path,{bigint:true});
    identities.push([path,String(stat.dev),String(stat.ino),String(stat.mode),String(stat.size),String(stat.mtimeNs)]);
    if(!stat.isFile()||stat.isSymbolicLink()||(!name.endsWith('.json')&&name!=='last_session')){unclassifiedEntries.push(path);continue;}
    if(stat.size>BigInt(LIMITS.fileBytes)||bytesRead+Number(stat.size)>LIMITS.bytes)fail('byte_limit');
    const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);let data:Buffer;
    try{
     const before=fstatSync(fd,{bigint:true});if(before.dev!==stat.dev||before.ino!==stat.ino||before.size!==stat.size)fail('changed');
     const buffer=Buffer.alloc(Number(stat.size)+1);let length=0;
     while(length<buffer.length){const n=readSync(fd,buffer,length,buffer.length-length,null);if(!n)break;length+=n;}
     const after=fstatSync(fd,{bigint:true});if(length!==Number(stat.size)||after.size!==stat.size||after.mtimeNs!==stat.mtimeNs)fail('changed');
     data=buffer.subarray(0,length);bytesRead+=length;
    }finally{closeSync(fd);}
    const hash=createHash('sha256').update(data).digest('hex');identities.push([path,hash]);
    if(name==='last_session'){if(data.length>512)fail('last_session');continue;}
    // Known alias metadata is inventoried and validated, never mistaken for a
    // native session. Admission still decides whether these references belong
    // to a previously retired domain; first initialization rejects them.
    if(name==='.session-aliases.json'){readSessionAliases(root);unclassifiedEntries.push(path);continue;}
    let value;try{value=JSON.parse(data.toString('utf8'));}catch{fail('snapshot_json');}
    if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.sessionId!=='string'||`${value.sessionId}.json`!==name||typeof value.cwd!=='string'||!Array.isArray(value.messages))fail('snapshot_schema');
    if(value.executionProtected!==undefined&&value.executionProtected!==true)fail('snapshot_schema');
    if(value.historyDigest!==undefined&&value.historyDigest!==computeSessionHistoryDigest(value))fail('history_digest');
    const compound=value.compoundOperations!==undefined?validateCompoundOperationLedger(value.compoundOperations):undefined;
    const semantic=value.semanticCompaction!==undefined?validateSemanticCompactionLedger(value.semanticCompaction):undefined;
    const hasUnsettledExecution=!!compound&&(compound.managedTurns?.records.some(row=>!['drained','cancelled_before_activation'].includes(row.state))||compound.operations.some(row=>row.stage!=='settled')||!!compound.directOperations?.some(row=>row.stage!=='settled')||!!compound.providerAttempts?.some(row=>!['drained','cancelled_before_send'].includes(row.transportState)))||!!semantic?.reservations.some(row=>!['settled','cancelled_before_dispatch'].includes(row.status));
    snapshots.push(Object.freeze({root:canonical,sessionId:value.sessionId,fileHash:hash,executionProtected:value.executionProtected===true,hasCompoundLedger:value.compoundOperations!==undefined,hasSemanticLedger:value.semanticCompaction!==undefined,hasObservationClosure:value.protectedObservationClosure!==undefined,hasUnsettledExecution}));
   }
  }
  return {snapshots:Object.freeze(snapshots),unclassifiedEntries:Object.freeze(unclassifiedEntries),bytesRead,entriesRead,digest:createHash('sha256').update(JSON.stringify(identities)).digest('hex')};
 }
 const initial=scan();
 const assertUnchanged=()=>{if(scan().digest!==initial.digest)fail('changed');};
 const result=Object.freeze({...initial,assertUnchanged});
 inventories.set(result,{assertUnchanged,facts:Object.freeze({...initial,roots:Object.freeze([...roots])})});
 return result as typeof result & CompoundSourceInventory;
}
