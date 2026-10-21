import {inspectBlobCapacityIssuer,readBlobCapacityIssuer} from './blob-capacity-issuer.js';
import {readInstalledCapacityAuthority,readInstalledCapacityLayer,claimInstalledCapacityLayer,finishInstalledCapacityLayer,failInstalledCapacityLayer} from './installed-controller.js';
import {readInstalledAuthorityBlobPool} from './authority-blob-budget.js';
import {assertInstalledCapacityDeleted} from './installed-shared-capacity.js';
import {inspectBlobTransactionCommand,executeBlobTransactionCommand,type BlobTransactionWriteContext} from './blob-transaction-command-dispatch.js';
import {consumeSharedBlobWholeContext,consumeSharedBlobReserveContext,assertSharedBlobCapacityDatabase,type createSharedBlobCapacity} from './shared-blob-capacity.js';
import {inspectPreparedCapacityCommand,executePreparedCapacityCommand} from './capacity-command-dispatch.js';
import type {CapacityWriteContext} from './capacity-command.js';
import type {Database} from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {openPrivateVerificationDatabase} from './private-database.js';
import {canonicalVerificationJson,VERIFICATION_BUDGET} from './protocol.js';
import {assertVerificationDatabaseBudget,runVerificationTransaction} from './storage-budget.js';
const sharedWholeCommands=new WeakMap<object,{budget:ReturnType<typeof createVerificationBlobBudget>;shared:object;database:Database;command:object;mode:'transaction'|'batch'}>();
export function inspectBlobSharedWholeCommand(command:object,shared:object,database:Database):boolean{const fact=sharedWholeCommands.get(command);if(!fact)return false;if(fact.shared!==shared||fact.database!==database)throw Error('blob_shared_command_owner');assertVerificationBlobBudgetDatabase(fact.budget,database);return true;}
export function executeBlobSharedWholeCommand(command:object,context:object):void{const fact=sharedWholeCommands.get(command);if(!fact)throw Error('blob_shared_command_brand');fact.budget.commitSharedWholeCommand(command,context);}
const sharedBatchCommands=new WeakMap<object,{budget:ReturnType<typeof createVerificationBlobBudget>;shared:object;database:Database;command:object;proposals:readonly Readonly<BlobReservationProposal>[];capacityBinding?:object;result?:readonly Readonly<{token:object;created:boolean}>[]}>();
export function inspectBlobSharedBatchCommand(command:object,shared:object,database:Database){const fact=sharedBatchCommands.get(command);if(!fact)return undefined;if(fact.shared!==shared||fact.database!==database)throw Error('blob_shared_command_owner');assertVerificationBlobBudgetDatabase(fact.budget,database);return Object.freeze({proposals:fact.proposals,capacityBinding:fact.capacityBinding});}
export function executeBlobSharedBatchCommand(command:object,context:object):void{const fact=sharedBatchCommands.get(command);if(!fact)throw Error('blob_shared_command_brand');fact.budget.commitSharedBatchCommand(command,context);}
const sharedReserveCommands=new WeakMap<object,{budget:ReturnType<typeof createVerificationBlobBudget>;shared:object;database:Database;proposal:Readonly<BlobReservationProposal>;kind:'reserve'|'release';proof?:object;capacityBinding?:object;producerCommand?:object;result?:readonly Readonly<{token:object;created:boolean}>[]}>();
export function inspectBlobSharedReserveCommand(command:object,shared:object,database:Database){const fact=sharedReserveCommands.get(command);if(!fact)return undefined;if(fact.shared!==shared||fact.database!==database)throw Error('blob_shared_command_owner');assertVerificationBlobBudgetDatabase(fact.budget,database);return Object.freeze({kind:fact.kind,proposal:fact.proposal,capacityBinding:fact.capacityBinding,proof:fact.proof});}
export function executeBlobSharedReserveCommand(command:object,context:object):void{const fact=sharedReserveCommands.get(command);if(!fact)throw Error('blob_shared_command_brand');fact.budget.commitSharedReserveCommand(command,context);}
const budgetDatabases=new WeakMap<object,{database:Database;authority:object;assertCurrent():void;state:{closed:boolean}}>();
export function assertVerificationBlobBudgetAuthority(budget:object,authority:object):void{const facts=budgetDatabases.get(budget);if(!facts||facts.authority!==authority||facts.state.closed)throw Error('verification_blob_database_identity');}
const blobTransactionCommands=new WeakMap<object,{budget:object;database:Database;command:object;transaction:BlobReservationTransaction;used:boolean}>();
export function consumeBlobTransactionContext(context:BlobTransactionWriteContext,budget:object,database:Database,command:object):BlobReservationTransaction{
 const fact=blobTransactionCommands.get(context);if(!fact||fact.used||fact.budget!==budget||fact.database!==database||fact.command!==command||!database.inTransaction)throw Error('blob_transaction_command_context');fact.used=true;return fact.transaction;
}
const commandContexts=new WeakMap<object,{budget:object;database:Database;command:object;tickets:readonly Readonly<{token:object;created:boolean}>[];used:boolean}>();
/** Fixed handlers consume a context once, only inside its original synchronous
 * transaction. The context does not expose SQL, the database, or run(work). */
export function consumeBlobCommandContext(context:CapacityWriteContext,budget:object,database:Database,command:object){
 const found=commandContexts.get(context);if(!found||found.used||found.budget!==budget||found.database!==database||found.command!==command||!database.inTransaction)throw Error('capacity_command_context');found.used=true;return found.tickets;
}
export function assertVerificationBlobBudgetDatabase(budget:object,database:Database):void{const known=budgetDatabases.get(budget);if(!known||known.database!==database)throw Error('verification_blob_database_identity');known.assertCurrent();}
export interface BlobReservationProposal {
 ownerKey:string;resourceId:string;kind:'host-staging'|'guest-input'|'guest-output'|'host-export';
 bytes:number;scopeDigest:string;engineBinding?:{engineId:string;incarnation:string};
}
declare const transactionBrand:unique symbol;
export interface BlobReservationTransaction {readonly [transactionBrand]:true}
interface Row {tuple_json:string;tuple_hash:string;state:'reserved'|'released'}
function frozen<T>(raw:T):T{const text=canonicalVerificationJson(raw);if(Buffer.byteLength(text)>65536)throw Error('verification_blob_metadata');const v=JSON.parse(text);const freeze=(x:any)=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}};freeze(v);return v;}
function digest(raw:unknown){return createHash('sha256').update(canonicalVerificationJson(raw)).digest('hex');}
function synchronous(result:unknown){if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error('verification_blob_authority_sync');}}
/** Shared durable accounting for every duplicate copy, including hard guest mount capacity.
 * A reservation alone grants no filesystem/engine permission. The protected resource
 * owner must provide a real, exact deletion receipt before any bytes are refunded.
 */
export function createVerificationBlobBudget(authority:object){
 if(arguments.length!==1)throw Error('capacity_authority_configuration');claimInstalledCapacityLayer(authority,'blob-budget');
 try{
 const {database:db,poolId:profileId}=readInstalledAuthorityBlobPool(authority),state={closed:false};
 const assertCurrent=()=>{const facts=readInstalledAuthorityBlobPool(authority);if(facts.database!==db||facts.poolId!==profileId)throw Error('authority_pool_changed');},assertDeleted=(proof:object,resource:Readonly<BlobReservationProposal>)=>assertInstalledCapacityDeleted(authority,proof,resource);
 const ownsDatabase=false,shared=readInstalledCapacityLayer(authority,'shared') as ReturnType<typeof createSharedBlobCapacity>;assertSharedBlobCapacityDatabase(shared,db);
 const transactionContexts=new WeakMap<object,{shared?:object;used:boolean}>();
 const consumedCommands=new WeakSet<object>();
 const tokens=new WeakMap<object,Readonly<BlobReservationProposal>>();let closed=false;
 db.exec('CREATE TABLE IF NOT EXISTS verification_blob_reservations(profile_id TEXT NOT NULL,resource_id TEXT NOT NULL,owner_key TEXT NOT NULL,kind TEXT NOT NULL,bytes INTEGER NOT NULL,tuple_hash TEXT NOT NULL,tuple_json TEXT NOT NULL,state TEXT NOT NULL,PRIMARY KEY(profile_id,resource_id))');
 function current(){if(closed)throw Error('verification_blob_closed');synchronous(assertCurrent());}
 function proposal(raw:BlobReservationProposal){const p=frozen(raw);const required=['ownerKey','resourceId','kind','bytes','scopeDigest',...(p.engineBinding?['engineBinding']:[])];if(Object.keys(p).sort().join(',')!==required.sort().join(','))throw Error('verification_blob_fields');
  if([p.ownerKey,p.resourceId].some(v=>typeof v!=='string'||!v.length||Buffer.byteLength(v)>1024||/[\x00-\x1f\x7f]/.test(v))||!['host-staging','guest-input','guest-output','host-export'].includes(p.kind)||!Number.isSafeInteger(p.bytes)||p.bytes<0||p.bytes>VERIFICATION_BUDGET.sessionBytes||!/^[a-f0-9]{64}$/.test(p.scopeDigest))throw Error('verification_blob_proposal');
  if(p.engineBinding&&(Object.keys(p.engineBinding).sort().join(',')!=='engineId,incarnation'||Object.values(p.engineBinding).some(v=>typeof v!=='string'||!v||Buffer.byteLength(v)>160)))throw Error('verification_blob_engine');return p;
 }
 function row(p:BlobReservationProposal){const value=db.prepare('SELECT tuple_json,tuple_hash,state FROM verification_blob_reservations WHERE profile_id=? AND resource_id=?').get(profileId,p.resourceId) as Row|undefined;if(!value||value.tuple_hash!==digest(p))throw Error('verification_blob_conflict');if(value.state!=='reserved')throw Error('verification_blob_released');return value;}
 function reserveLocal(raw:BlobReservationProposal):Readonly<{token:object;created:boolean}>{const p=proposal(raw);current();return runVerificationTransaction(db,()=>{
   const previous=db.prepare('SELECT tuple_json,tuple_hash,state FROM verification_blob_reservations WHERE profile_id=? AND resource_id=?').get(profileId,p.resourceId) as Row|undefined;
   if(previous){row(p);const token=Object.freeze({});tokens.set(token,p);return Object.freeze({token,created:false});}
   const total=db.prepare("SELECT COALESCE(SUM(bytes),0) n FROM verification_blob_reservations WHERE profile_id=? AND state='reserved'").get(profileId) as {n:number};
   const owner=db.prepare("SELECT COALESCE(SUM(bytes),0) n FROM verification_blob_reservations WHERE profile_id=? AND owner_key=? AND state='reserved'").get(profileId,p.ownerKey) as {n:number};
   if(total.n+p.bytes>VERIFICATION_BUDGET.archiveBytes||owner.n+p.bytes>VERIFICATION_BUDGET.sessionBytes)throw Error('verification_blob_capacity');
   assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(canonicalVerificationJson(p))+1024});
   db.prepare("INSERT INTO verification_blob_reservations VALUES(?,?,?,?,?,?,?,'reserved')").run(profileId,p.resourceId,p.ownerKey,p.kind,p.bytes,digest(p),canonicalVerificationJson(p));const token=Object.freeze({});tokens.set(token,p);return Object.freeze({token,created:true});
  });
 }
 function reserveThroughShared(p:Readonly<BlobReservationProposal>,capacityBinding?:object,producerCommand?:object){if(!shared)throw Error('blob_shared_command_owner');const command=Object.freeze({}),fact={budget,shared,database:db,proposal:p,kind:'reserve' as const,capacityBinding,producerCommand,result:undefined as readonly Readonly<{token:object;created:boolean}>[]|undefined};sharedReserveCommands.set(command,fact);try{shared.reserveCommand(command);if(!fact.result)throw Error('blob_shared_command_result');return fact.result;}finally{sharedReserveCommands.delete(command);}}
 function recordIssuer(command:object):void{const facts=inspectPreparedCapacityCommand(command,budget,db);for(const allocation of facts.allocations){const actual=inspectBlobCapacityIssuer(db,allocation);if(actual.issuerKind!==facts.issuerFamily&&!(facts.issuerFamily==='raw'&&actual.issuerKind==='qualification-mounted'))throw Error('blob_issuer_command');const encoded=canonicalVerificationJson(actual),old=db.prepare('SELECT allocation_hash,record_json,record_hash FROM shared_blob_issuers WHERE resource_id=?').get(allocation.resourceId) as {allocation_hash:string;record_json:string;record_hash:string}|undefined;if(old){readBlobCapacityIssuer(db,allocation);}else{assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(encoded)+4096});db.prepare('INSERT INTO shared_blob_issuers VALUES(?,?,?,?)').run(allocation.resourceId,digest(allocation),encoded,digest(actual));readBlobCapacityIssuer(db,allocation);}}}
 function reserveCommand(command:object,transaction?:BlobReservationTransaction,admitted=false):readonly Readonly<{token:object;created:boolean}>[]{
  const facts=inspectPreparedCapacityCommand(command,budget,db);if(!admitted){if(consumedCommands.has(command))throw Error('capacity_command_consumed');consumedCommands.add(command);}current();if(facts.allocations.length<1||facts.allocations.length>16)throw Error('capacity_command_cardinality');const proposals=facts.allocations.map(proposal);let result!:readonly Readonly<{token:object;created:boolean}>[];
  const work=()=>{result=Object.freeze(proposals.map(reserveLocal));const context=Object.freeze({}),entry={budget,database:db,command,tickets:result,used:false};commandContexts.set(context,entry);try{executePreparedCapacityCommand(command,context);if(!entry.used)throw Error('capacity_command_context');recordIssuer(command);}finally{commandContexts.delete(context);}};
  if(transaction){const existing=transactionContexts.get(transaction);if(!existing||existing.used||!db.inTransaction)throw Error('verification_blob_transaction');existing.used=true;if(shared){if(!existing.shared)throw Error('verification_blob_transaction');const prepared=Object.freeze({}),record={budget,shared,database:db,command,proposals,capacityBinding:facts.capacityBinding,result:undefined as readonly Readonly<{token:object;created:boolean}>[]|undefined};sharedBatchCommands.set(prepared,record);try{shared.reserveBatchCommand(prepared,existing.shared);if(!record.result)throw Error('blob_shared_command_result');result=record.result;}finally{sharedBatchCommands.delete(prepared);}}else work();}
  else if(shared){if(proposals.length===1)result=reserveThroughShared(proposals[0]!,facts.capacityBinding,command);else{const prepared=Object.freeze({});sharedWholeCommands.set(prepared,{budget,shared,database:db,command,mode:'batch'});try{shared.executeTransactionCommand(prepared);const completed=completedBatchResults.get(command);if(!completed)throw Error('blob_shared_command_result');result=completed;}finally{sharedWholeCommands.delete(prepared);completedBatchResults.delete(command);}}}
  else runVerificationTransaction(db,work);return result;
 }
 const completedBatchResults=new WeakMap<object,readonly Readonly<{token:object;created:boolean}>[]>();
 function invokeTransactionCommand(command:object,sharedContext?:object){const transaction=Object.freeze({}) as BlobReservationTransaction;transactionContexts.set(transaction,{shared:sharedContext,used:false});const context=Object.freeze({}),fact={budget,database:db,command,transaction,used:false};blobTransactionCommands.set(context,fact);try{executeBlobTransactionCommand(command,context);if(!fact.used)throw Error('blob_transaction_command_context');current();}finally{blobTransactionCommands.delete(context);transactionContexts.delete(transaction);}}

 const budget=Object.freeze({
  commitSharedReserveCommand(command:object,sharedContext:object):void{const fact=sharedReserveCommands.get(command);if(!fact||fact.budget!==budget||fact.database!==db||fact.shared!==shared)throw Error('blob_shared_command_owner');consumeSharedBlobReserveContext(sharedContext,shared!,db,command);current();if(fact.kind==='release'){row(fact.proposal);db.prepare("UPDATE verification_blob_reservations SET state='released' WHERE profile_id=? AND resource_id=?").run(profileId,fact.proposal.resourceId);return;}const tickets=Object.freeze([reserveLocal(fact.proposal)]);if(fact.producerCommand){const context=Object.freeze({}),entry={budget,database:db,command:fact.producerCommand,tickets,used:false};commandContexts.set(context,entry);try{executePreparedCapacityCommand(fact.producerCommand,context);if(!entry.used)throw Error('capacity_command_context');recordIssuer(fact.producerCommand);}finally{commandContexts.delete(context);}}current();fact.result=tickets;},
  usesSharedCapacity:!!shared,
  reserveCommand(command:object):Readonly<{token:object;created:boolean}>{if(arguments.length!==1)throw Error('capacity_command_shape');const facts=inspectPreparedCapacityCommand(command,budget,db);if(facts.allocations.length!==1)throw Error('capacity_command_cardinality');return reserveCommand(command)[0]!;},
  reserveBatchCommand(command:object,transaction?:BlobReservationTransaction){if(arguments.length<1||arguments.length>2)throw Error('capacity_command_shape');return reserveCommand(command,transaction);},
  executeTransactionCommand(command:object):void{if(arguments.length!==1)throw Error('blob_transaction_command_shape');inspectBlobTransactionCommand(command,budget,db);if(consumedCommands.has(command))throw Error('capacity_command_consumed');consumedCommands.add(command);current();if(db.inTransaction)throw Error('verification_blob_outer_transaction');if(shared){const prepared=Object.freeze({});sharedWholeCommands.set(prepared,{budget,shared,database:db,command,mode:'transaction'});try{shared.executeTransactionCommand(prepared);}finally{sharedWholeCommands.delete(prepared);}}else runVerificationTransaction(db,()=>invokeTransactionCommand(command));},
  commitSharedWholeCommand(prepared:object,sharedContext:object):void{const fact=sharedWholeCommands.get(prepared);if(!fact||fact.budget!==budget||fact.shared!==shared||fact.database!==db)throw Error('blob_shared_command_owner');consumeSharedBlobWholeContext(sharedContext,shared!,db,prepared);if(fact.mode==='transaction')invokeTransactionCommand(fact.command,sharedContext);else{const transaction=Object.freeze({}) as BlobReservationTransaction;transactionContexts.set(transaction,{shared:sharedContext,used:false});try{completedBatchResults.set(fact.command,reserveCommand(fact.command,transaction,true));}finally{transactionContexts.delete(transaction);}}},
  commitSharedBatchCommand(prepared:object,sharedContext:object):void{const fact=sharedBatchCommands.get(prepared);if(!fact||fact.budget!==budget||fact.shared!==shared||fact.database!==db)throw Error('blob_shared_command_owner');consumeSharedBlobReserveContext(sharedContext,shared!,db,prepared);current();const tickets=Object.freeze(fact.proposals.map(reserveLocal)),context=Object.freeze({}),entry={budget,database:db,command:fact.command,tickets,used:false};commandContexts.set(context,entry);try{executePreparedCapacityCommand(fact.command,context);if(!entry.used)throw Error('capacity_command_context');recordIssuer(fact.command);}finally{commandContexts.delete(context);}current();fact.result=tickets;},

  /** Before external I/O; pure reserveWithCommit composition still permits nested transactions. */
  assertExternalOperationBoundary():void{current();if(db.inTransaction)throw Error('verification_blob_outer_transaction');},
  reserve(raw:BlobReservationProposal):Readonly<{token:object;created:boolean}>{if(arguments.length!==1)throw Error('verification_blob_fields');let result!:Readonly<{token:object;created:boolean}>;const p=proposal(raw);if(shared&&!shared.recoverUnregisteredReservation(p))result=reserveThroughShared(p)[0]!;else result=reserveLocal(p);return result;},
  getState(raw:BlobReservationProposal):'reserved'|'released'|undefined{current();const p=proposal(raw);const found=db.prepare('SELECT tuple_hash,state FROM verification_blob_reservations WHERE profile_id=? AND resource_id=?').get(profileId,p.resourceId) as Row|undefined;if(found&&found.tuple_hash!==digest(p))throw Error('verification_blob_conflict');return found?.state;},
  assertReserved(token:object,raw:BlobReservationProposal):void{current();const p=tokens.get(token);if(!p)throw Error('verification_blob_token');if(digest(proposal(raw))!==digest(p))throw Error('verification_blob_conflict');row(p);},
  release(token:object,proof:object):void{current();const p=tokens.get(token);if(!p)throw Error('verification_blob_token');synchronous(assertDeleted(proof,p));const work=()=>{current();row(p);db.prepare("UPDATE verification_blob_reservations SET state='released' WHERE profile_id=? AND resource_id=?").run(profileId,p.resourceId);};if(shared){const command=Object.freeze({});sharedReserveCommands.set(command,{budget,shared,database:db,proposal:p,kind:'release',proof});try{shared.releaseCommand(command);}finally{sharedReserveCommands.delete(command);}}else runVerificationTransaction(db,work);},
  close(){if(!closed){closed=true;state.closed=true;if(ownsDatabase)db.close();}},
 });
 budgetDatabases.set(budget,{database:db,authority,assertCurrent:current,state});finishInstalledCapacityLayer(authority,'blob-budget',budget);return budget;
 }catch(error){failInstalledCapacityLayer(authority,'blob-budget');throw error;}
}
