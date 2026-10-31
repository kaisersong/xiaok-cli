import {createHash} from 'node:crypto';
import {readInstalledMaintenanceSeal} from './installed-controller.js';
import type {Database} from 'better-sqlite3';
import {canonicalVerificationJson as json} from './protocol.js';
import {assertVerificationDatabaseBudget,runVerificationTransaction} from './storage-budget.js';
import {assertInstalledControllerLifetime,type InstalledControllerLifetime} from './installed-controller-lifetime.js';
import {readBlobCapacityIssuer,type BlobIssuerRecord} from './blob-capacity-issuer.js';
import type {BlobReservationProposal} from './blob-budget.js';
import {inspectDockerCleanupHandoffCommand} from '../isolated-execution/docker-runner.js';
import {inspectStagingCleanupHandoffCommand} from './staging-factual-cleanup.js';
import {readInstalledCleanupOwner,assertInstalledStackDrained} from './installed-execution-stack.js';
import {assertNativeSqliteProducerTableKinds,assertNativeSqliteStoredProducerColumns} from './native-sqlite-census.js';
import type {QuiescenceExpectation} from '../isolated-execution/physical-quiescence.js';

export interface InstalledCleanupCommandFacts {readonly source:object;readonly database:Database;readonly kind:'raw'|'material';readonly resourceId:string;readonly expected:QuiescenceExpectation|null;readonly allocations:readonly Readonly<BlobReservationProposal>[];readonly action:'request'|'ack';readonly evidence?:string}
interface Target {kind:'raw'|'material';resourceId:string;expected:QuiescenceExpectation|null;allocations:readonly Readonly<BlobReservationProposal>[];issuers:readonly object[]}
interface Header {authority_id:string;origin_epoch:string;phase:'requested'|'sealed'|'claimed'|'failed-retained'|'completed';revision:number;claim_epoch:string|null;items_hash:string;close_attempt_id:string|null}
interface Item {authority_id:string;origin_epoch:string;item_id:string;target_json:string;target_hash:string;outcome:'requested'|'completed';evidence_hash:string|null}
const headerSQL="CREATE TABLE verification_maintenance_handoffs(authority_id TEXT NOT NULL,origin_epoch TEXT NOT NULL,phase TEXT NOT NULL CHECK(phase IN ('requested','sealed','claimed','failed-retained','completed')),revision INTEGER NOT NULL CHECK(revision>=1),claim_epoch TEXT,items_hash TEXT NOT NULL,close_attempt_id TEXT,PRIMARY KEY(authority_id,origin_epoch))";
const itemSQL="CREATE TABLE verification_maintenance_handoff_items(authority_id TEXT NOT NULL,origin_epoch TEXT NOT NULL,item_id TEXT NOT NULL,target_json TEXT NOT NULL,target_hash TEXT NOT NULL,outcome TEXT NOT NULL CHECK(outcome IN ('requested','completed')),evidence_hash TEXT,PRIMARY KEY(authority_id,origin_epoch,item_id))";
const claims=new WeakMap<object,{lifetime:InstalledControllerLifetime;header:Header;items:readonly Item[]}>(),activeClaims=new WeakMap<object,object>();
const hash=(value:unknown)=>createHash('sha256').update(json(value)).digest('hex');
function ownFields(value:unknown,keys:readonly string[]):asserts value is Record<string,unknown>{
 if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype)throw Error('maintenance_handoff_target_schema');const descriptors=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(descriptors);if(names.length!==keys.length||names.some(key=>typeof key!=='string'||!keys.includes(key)||!('value' in descriptors[key]!)))throw Error('maintenance_handoff_target_schema');
}
function boundedText(value:unknown,max=160):asserts value is string{if(typeof value!=='string'||!value||Buffer.byteLength(value)>max||/[\x00-\x1f\x7f]/.test(value))throw Error('maintenance_handoff_target_schema');}
function digestText(value:unknown):asserts value is string{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw Error('maintenance_handoff_target_schema');}
function bytes(value:unknown):asserts value is number{if(!Number.isSafeInteger(value)||typeof value!=='number'||value<0)throw Error('maintenance_handoff_target_schema');}
function decodeAllocation(value:unknown):Readonly<BlobReservationProposal>{
 const hasEngine=!!value&&typeof value==='object'&&Object.hasOwn(value,'engineBinding');ownFields(value,['ownerKey','resourceId','kind','bytes','scopeDigest',...(hasEngine?['engineBinding']:[])]);boundedText(value.ownerKey,1024);boundedText(value.resourceId);digestText(value.scopeDigest);bytes(value.bytes);
 if(value.kind!=='host-staging'&&value.kind!=='guest-input'&&value.kind!=='guest-output'&&value.kind!=='host-export')throw Error('maintenance_handoff_target_schema');
 let engineBinding:BlobReservationProposal['engineBinding'];if(hasEngine){ownFields(value.engineBinding,['engineId','incarnation']);boundedText(value.engineBinding.engineId);boundedText(value.engineBinding.incarnation);engineBinding={engineId:value.engineBinding.engineId,incarnation:value.engineBinding.incarnation};}
 return {ownerKey:value.ownerKey,resourceId:value.resourceId,kind:value.kind,bytes:value.bytes,scopeDigest:value.scopeDigest,...(engineBinding?{engineBinding}:{})};
}
function decodeTarget(text:string):Target{
 if(Buffer.byteLength(text)>65536)throw Error('maintenance_handoff_target_schema');const value:unknown=JSON.parse(text);ownFields(value,['kind','resourceId','expected','allocations','issuers']);if(value.kind!=='raw'&&value.kind!=='material')throw Error('maintenance_handoff_target_schema');boundedText(value.resourceId);
 let expected:QuiescenceExpectation|null=null;if(value.kind==='raw'){ownFields(value.expected,['sessionIdentity','compoundOperationId','validationInvocationId','executionIdentity','scopeDigest']);const e=value.expected;boundedText(e.sessionIdentity);boundedText(e.compoundOperationId);boundedText(e.validationInvocationId);boundedText(e.executionIdentity);digestText(e.scopeDigest);
  expected={sessionIdentity:e.sessionIdentity,compoundOperationId:e.compoundOperationId,validationInvocationId:e.validationInvocationId,executionIdentity:e.executionIdentity,scopeDigest:e.scopeDigest};if(expected.executionIdentity!==value.resourceId)throw Error('maintenance_handoff_target_schema');
 }else if(value.expected!==null)throw Error('maintenance_handoff_target_schema');
 const count=value.kind==='raw'?2:1;if(!Array.isArray(value.allocations)||value.allocations.length!==count||!Array.isArray(value.issuers)||value.issuers.length!==count)throw Error('maintenance_handoff_target_schema');const allocations=value.allocations.map(decodeAllocation);if(new Set(allocations.map(p=>p.resourceId)).size!==count)throw Error('maintenance_handoff_target_schema');
 if(value.kind==='raw'&&(allocations[0]!.kind!=='guest-input'||allocations[1]!.kind!=='guest-output'||allocations.some(p=>p.scopeDigest!==expected?.scopeDigest))||value.kind==='material'&&(allocations[0]!.kind!=='host-staging'||allocations[0]!.resourceId!==value.resourceId))throw Error('maintenance_handoff_target_schema');
 const kind=value.kind,resourceId=value.resourceId,issuers:BlobIssuerRecord[]=value.issuers.map((item:unknown,index:number):BlobIssuerRecord=>{ownFields(item,['version','resourceId','allocationHash','ownerKey','scopeDigest','bytes','issuerKind','producerResourceId','producerLineageHash']);if(item.version!==1||item.issuerKind!==(kind==='raw'?'raw':'material'))throw Error('maintenance_handoff_target_schema');boundedText(item.resourceId);boundedText(item.ownerKey,1024);boundedText(item.producerResourceId);digestText(item.allocationHash);digestText(item.scopeDigest);digestText(item.producerLineageHash);bytes(item.bytes);const allocation=allocations[index]!;if(item.resourceId!==allocation.resourceId||item.allocationHash!==hash(allocation)||item.ownerKey!==allocation.ownerKey||item.scopeDigest!==allocation.scopeDigest||item.bytes!==allocation.bytes||item.producerResourceId!==resourceId)throw Error('maintenance_handoff_target_schema');return {version:1,resourceId:item.resourceId,allocationHash:item.allocationHash,ownerKey:item.ownerKey,scopeDigest:item.scopeDigest,bytes:item.bytes,issuerKind:kind==='raw'?'raw':'material',producerResourceId:item.producerResourceId,producerLineageHash:item.producerLineageHash};});
 return {kind,resourceId,expected,allocations,issuers};
}
function schema(db:Database,create=false){
 assertNativeSqliteProducerTableKinds(db);
 const definitions=[['verification_maintenance_handoffs',headerSQL],['verification_maintenance_handoff_items',itemSQL]] as const;
 const present=definitions.map(([name])=>db.prepare<[string],{sql:string}>("SELECT sql FROM main.sqlite_master WHERE name=?").get(name));
 if(present.every(row=>!row)&&!create)return false;
 if(present.some(Boolean)&&present.some(row=>!row))throw Error('maintenance_handoff_schema');
 if(!present[0]){assertVerificationDatabaseBudget(db,{additionalBytes:16384});for(const [,sql] of definitions)db.exec(sql);}
 for(const [name,sql] of definitions){const row=db.prepare<[string],{sql:string}>("SELECT sql FROM main.sqlite_master WHERE type='table' AND name=?").get(name);if(row?.sql!==sql)throw Error('maintenance_handoff_schema');assertNativeSqliteStoredProducerColumns(db,name);}
 return true;
}
function items(db:Database,h:Pick<Header,'authority_id'|'origin_epoch'>){return db.prepare<[string,string],Item>('SELECT * FROM verification_maintenance_handoff_items WHERE authority_id=? AND origin_epoch=? ORDER BY item_id').all(h.authority_id,h.origin_epoch);}
function itemHash(rows:readonly Item[]){return hash(rows.map(row=>({itemId:row.item_id,targetJson:row.target_json,targetHash:row.target_hash})));}
function verifyItems(db:Database,h:Header){
 const rows=items(db,h);if(!rows.length||rows.length>4096||itemHash(rows)!==h.items_hash)throw Error('maintenance_handoff_items');
 for(const row of rows){const target=decodeTarget(row.target_json);if(json(target)!==row.target_json||hash(target)!==row.target_hash||row.item_id!==hash({kind:target.kind,resourceId:target.resourceId})||!['requested','completed'].includes(row.outcome)||(row.outcome==='completed')!==(typeof row.evidence_hash==='string'&&/^[a-f0-9]{64}$/.test(row.evidence_hash)))throw Error('maintenance_handoff_item');}
 return rows;
}
function targetFor(f:InstalledCleanupCommandFacts):Target{
 if(!f.allocations.length||f.allocations.length>2||!f.resourceId||f.resourceId.length>160)throw Error('maintenance_handoff_target');
 return {kind:f.kind,resourceId:f.resourceId,expected:f.expected,allocations:f.allocations,issuers:f.allocations.map(p=>readBlobCapacityIssuer(f.database,p))};
}
function header(db:Database,authority:string,origin:string){const row=db.prepare<[string,string],Header>('SELECT * FROM verification_maintenance_handoffs WHERE authority_id=? AND origin_epoch=?').get(authority,origin);if(!row)throw Error('maintenance_handoff_missing');return row;}
/** Only original producers issue commands. This commits before their irreversible I/O. */
export function persistInstalledMaintenanceRequest(command:object):void{
 const f=inspectDockerCleanupHandoffCommand(command)??inspectStagingCleanupHandoffCommand(command);if(!f)throw Error('maintenance_handoff_command');
 const owner=readInstalledCleanupOwner(f.source,f.kind==='raw'?'execution':'materials');if(!owner)return;
 const lifetime=owner.lifetime;assertInstalledControllerLifetime(lifetime);if(lifetime.database!==f.database)throw Error('maintenance_handoff_database');
 const db=f.database,target=targetFor(f),encoded=json(target),targetHash=hash(target),id=hash({kind:f.kind,resourceId:f.resourceId}),authority=lifetime.manifest.authorityId;
 if(Buffer.byteLength(encoded)>65536)throw Error('maintenance_handoff_size');
 runVerificationTransaction(db,()=>{
  schema(db,true);assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(encoded)+8192});
  let origin=lifetime.serviceEpoch;
  if(owner.kind==='maintenance'){
   const token=activeClaims.get(lifetime),claim=token&&claims.get(token);if(!claim)throw Error('maintenance_handoff_claim');origin=claim.header.origin_epoch;
   const h=header(db,authority,origin);if(json(h)!==json(claim.header)||h.claim_epoch!==lifetime.serviceEpoch||h.phase!=='claimed')throw Error('maintenance_handoff_fence');
  }
  const old=db.prepare<[string,string,string],Item>('SELECT * FROM verification_maintenance_handoff_items WHERE authority_id=? AND origin_epoch=? AND item_id=?').get(authority,origin,id);
  if(owner.kind==='maintenance'&&!old)throw Error('maintenance_handoff_unrequested');
  if(old&&(old.target_json!==encoded||old.target_hash!==targetHash))throw Error('maintenance_handoff_changed');
  let h=db.prepare<[string,string],Header>('SELECT * FROM verification_maintenance_handoffs WHERE authority_id=? AND origin_epoch=?').get(authority,origin);
  if(!old){
   if(f.action!=='request'||h&&h.phase!=='requested')throw Error('maintenance_handoff_sealed');
   if(!h){db.prepare('INSERT INTO verification_maintenance_handoffs VALUES(?,?,?,?,?,?,?)').run(authority,origin,'requested',1,null,hash([]),null);h=header(db,authority,origin);}
   if(items(db,h).length>=4096)throw Error('maintenance_handoff_capacity');
   db.prepare('INSERT INTO verification_maintenance_handoff_items VALUES(?,?,?,?,?,?,?)').run(authority,origin,id,encoded,targetHash,'requested',null);
   const digest=itemHash(items(db,h));if(db.prepare("UPDATE verification_maintenance_handoffs SET items_hash=?,revision=revision+1 WHERE authority_id=? AND origin_epoch=? AND phase='requested' AND revision=? AND items_hash=?").run(digest,authority,origin,h.revision,h.items_hash).changes!==1)throw Error('maintenance_handoff_commit');
  }
  if(f.action==='ack'){
   if(!old||!f.evidence||!['requested','claimed'].includes(header(db,authority,origin).phase))throw Error('maintenance_handoff_ack');
   const evidenceHash=hash({targetHash,evidence:f.evidence});
   // Timely completion is monotonic. A lost ack is recovered by the actual producer
   // repeating its original absence/tombstone and dual-ledger checks, never by a row flag.
   if(old.outcome==='completed')return;
   if(db.prepare("UPDATE verification_maintenance_handoff_items SET outcome='completed',evidence_hash=? WHERE authority_id=? AND origin_epoch=? AND item_id=? AND target_hash=? AND outcome='requested' AND evidence_hash IS NULL").run(evidenceHash,authority,origin,id,targetHash).changes!==1)throw Error('maintenance_handoff_ack');
  }
 });
}
/** Only a real drained normal stack can seal its already accepted requests. */
export function sealInstalledMaintenanceRequests(lifetime:InstalledControllerLifetime,stack:object):void{
 assertInstalledControllerLifetime(lifetime);assertInstalledStackDrained(stack,lifetime);const closeAttemptId=readInstalledMaintenanceSeal(lifetime,stack);const db=lifetime.database;if(!schema(db))return;
 runVerificationTransaction(db,()=>{const h=db.prepare<[string,string],Header>('SELECT * FROM verification_maintenance_handoffs WHERE authority_id=? AND origin_epoch=?').get(lifetime.manifest.authorityId,lifetime.serviceEpoch);if(!h)return;if(h.phase!=='requested')throw Error('maintenance_handoff_seal');const rows=verifyItems(db,h);assertVerificationDatabaseBudget(db,{additionalBytes:4096});const phase=rows.every(row=>row.outcome==='completed')?'completed':'sealed';if(db.prepare("UPDATE verification_maintenance_handoffs SET phase=?,close_attempt_id=?,revision=revision+1 WHERE authority_id=? AND origin_epoch=? AND phase='requested' AND revision=? AND items_hash=? AND claim_epoch IS NULL").run(phase,closeAttemptId,h.authority_id,h.origin_epoch,h.revision,h.items_hash).changes!==1)throw Error('maintenance_handoff_seal');});
}
/** New actual lifetime / unique installed lock is required; it proves no guest fact. */
export function claimInstalledMaintenanceBatch(lifetime:InstalledControllerLifetime):object|undefined{
 assertInstalledControllerLifetime(lifetime);const db=lifetime.database;if(!schema(db))return undefined;if(activeClaims.has(lifetime))throw Error('maintenance_handoff_claim_used');
 return runVerificationTransaction(db,()=>{
  const h=db.prepare<[string],Header>("SELECT * FROM verification_maintenance_handoffs WHERE authority_id=? AND phase IN ('sealed','claimed','failed-retained') ORDER BY origin_epoch LIMIT 1").get(lifetime.manifest.authorityId);if(!h)return undefined;
  if(!h.close_attempt_id||h.origin_epoch===lifetime.serviceEpoch||h.claim_epoch===lifetime.serviceEpoch||!Number.isSafeInteger(h.revision)||h.revision<1||h.phase==='sealed'&&h.claim_epoch!==null||h.phase!=='sealed'&&!h.claim_epoch)throw Error('maintenance_handoff_origin');
  const rows=verifyItems(db,h);for(const row of rows){const t=decodeTarget(row.target_json);if(json(t.issuers)!==json(t.allocations.map(p=>readBlobCapacityIssuer(db,p))))throw Error('maintenance_handoff_lineage');}
  assertVerificationDatabaseBudget(db,{additionalBytes:4096});
  if(db.prepare('UPDATE verification_maintenance_handoffs SET phase=\'claimed\',claim_epoch=?,revision=revision+1 WHERE authority_id=? AND origin_epoch=? AND phase=? AND revision=? AND claim_epoch IS ? AND items_hash=? AND close_attempt_id=?').run(lifetime.serviceEpoch,h.authority_id,h.origin_epoch,h.phase,h.revision,h.claim_epoch,h.items_hash,h.close_attempt_id).changes!==1)throw Error('maintenance_handoff_claim_fence');
  const token=Object.freeze({}),current=header(db,h.authority_id,h.origin_epoch);claims.set(token,{lifetime,header:current,items:rows});activeClaims.set(lifetime,token);return token;
 });
}
export function readInstalledMaintenanceBatch(token:object,lifetime:InstalledControllerLifetime):readonly Readonly<Target>[] {
 const known=claims.get(token);assertInstalledControllerLifetime(lifetime);if(!known||known.lifetime!==lifetime||activeClaims.get(lifetime)!==token)throw Error('maintenance_handoff_claim');const current=header(lifetime.database,known.header.authority_id,known.header.origin_epoch);if(json(current)!==json(known.header)||current.phase!=='claimed')throw Error('maintenance_handoff_fence');const rows=verifyItems(lifetime.database,current);if(json(rows.map(r=>r.target_json))!==json(known.items.map(r=>r.target_json)))throw Error('maintenance_handoff_items');return rows.filter(r=>r.outcome!=='completed').map(r=>Object.freeze(decodeTarget(r.target_json)));
}
export function finishInstalledMaintenanceBatch(token:object,lifetime:InstalledControllerLifetime,failed:boolean):void{
 readInstalledMaintenanceBatch(token,lifetime);const known=claims.get(token);if(!known)throw Error('maintenance_handoff_claim');const h=known.header,db=lifetime.database;
 runVerificationTransaction(db,()=>{const rows=verifyItems(db,h);if(!failed&&rows.some(row=>row.outcome!=='completed'))throw Error('maintenance_handoff_incomplete');assertVerificationDatabaseBudget(db,{additionalBytes:4096});if(db.prepare('UPDATE verification_maintenance_handoffs SET phase=?,revision=revision+1 WHERE authority_id=? AND origin_epoch=? AND phase=? AND revision=? AND claim_epoch=? AND items_hash=? AND close_attempt_id=?').run(failed?'failed-retained':'completed',h.authority_id,h.origin_epoch,h.phase,h.revision,h.claim_epoch,h.items_hash,h.close_attempt_id).changes!==1)throw Error('maintenance_handoff_finish_fence');});
}
