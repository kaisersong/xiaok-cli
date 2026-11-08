import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {loadOriginalRootLedgerSource} from './original-root-ledger-source-loader.js';

const descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,keys=Reflect.ownKeys;
const parse=JSON.parse,freeze=Object.freeze,apply=Reflect.apply,isProxy=types.isProxy;
const domain=Buffer.from('xiaok.original-root-nmp-ledger/v1\0');
const limit=64*1024*1024;
const names=['root_resource_floor','root_resource_policy','root_resources','root_launch_outbox','root_resource_receipts','root_physical_policy','root_physical_resources','root_physical_receipts','root_pool_identity','root_pool_io_binding'] as const;
const columns=[
 ['singleton','profile','schema_version','semantic_digest','guard_abi','issuer_epoch'],
 ['singleton','owner_digest','issuer_json','capacity','queue_limit','next_seq','human_burst','claim_seq'],
 ['record_id','execution_key','metadata_json','metadata_digest','enqueue_seq','revision','generation','issuer_epoch','state','claim_token','attempt_id'],
 ['record_id','revision','state'],['record_id','kind','binding_hash','receipt_json'],
 ['kind','owner_digest','issuer_json','capacity','queue_limit','next_seq','human_burst','claim_seq'],
 ['record_id','resource_kind','execution_class','execution_key','metadata_json','metadata_digest','enqueue_seq','state','claim_token','generation','issuer_epoch','allocation_role','parent_record_id','native_root_id'],
 ['record_id','kind','binding_hash','receipt_json'],
 ['singleton','identity_version','pool_id','owner_uid','directory_device','directory_inode','directory_mode','lock_device','lock_inode','lock_mode','database_device','database_inode','database_mode'],
 ['singleton','binding_version','pool_id','namespace_id','birth_id','claim_id','anchor_digest','profile_digest','file_owner_uid','directory_nlink','lock_nlink','database_nlink'],
] as const;
export type RootNmpLedgerCell=readonly ['null']|readonly ['integer'|'text'|'blob',string];
export interface OriginalRootNmpLedger {
 readonly kind:'original_root_nmp_ledger_v1';readonly observation:'history-observation-only';
 readonly sourceKind:'live-session'|'existing-ordinary-readonly';readonly poolScope:'account-global';
 readonly profile:string;readonly schemaVersion:3|4;readonly semanticDigest:string;readonly poolId:string;readonly ownerUid:string;
 readonly sourceIdentity:Readonly<{kind:'ordinary-current-files-v1'|'protected-anchor-birth-audit-v2';facts:readonly (readonly string[])[]}>;
 readonly schema:readonly (readonly RootNmpLedgerCell[])[];
 readonly tables:readonly Readonly<{name:string;columns:readonly string[];rows:readonly (readonly RootNmpLedgerCell[])[]}>[];
}
function invalid():never{throw Error('ROOT_LEDGER_PROJECTION_UNCONFIRMED');}
function data(raw:unknown,name:string):unknown{
 if(!raw||typeof raw!=='object'||isProxy(raw))invalid();const d=descriptor(raw,name);if(!d||!own(d,'value'))invalid();return d.value;
}
function exact(raw:unknown,expected:readonly string[]):void{
 if(!raw||typeof raw!=='object'||isProxy(raw))invalid();const actual=keys(raw);
 if(actual.length!==expected.length)invalid();for(let i=0;i<actual.length;i++)if(typeof actual[i]!=='string'||!expected.includes(actual[i] as string))invalid();
}
function rows(raw:unknown,width:number):readonly (readonly RootNmpLedgerCell[])[]{
 if(!Array.isArray(raw))invalid();
 for(let i=0;i<raw.length;i++){
  const row:unknown=raw[i];if(!Array.isArray(row)||row.length!==width)invalid();
  for(let j=0;j<row.length;j++){
   const cell:unknown=row[j];if(!Array.isArray(cell))invalid();
   if(cell[0]==='null'){if(cell.length!==1)invalid();}
   else if(cell.length!==2||typeof cell[1]!=='string')invalid();
   else if(cell[0]==='integer'){
    if(!/^(?:0|-?[1-9][0-9]*)$/.test(cell[1]))invalid();const n=BigInt(cell[1]);if(n<-(1n<<63n)||n>=(1n<<63n))invalid();
   }else if((cell[0]!=='text'&&cell[0]!=='blob')||!/^(?:[a-f0-9]{2})*$/.test(cell[1]))invalid();
   freeze(cell);
  }freeze(row);
 }return freeze(raw) as readonly (readonly RootNmpLedgerCell[])[];
}
/** Closed metadata decoder only. Neither these bytes nor their checksum are a
 * Source identity, spendability, terminal fate or enrollment certificate. */
export function decodeOriginalRootNmpLedger(raw:unknown):OriginalRootNmpLedger{
 exact(raw,['kind','canonicalJson','sha256']);
 if(data(raw,'kind')!=='original_root_nmp_ledger_capture_v1')invalid();
 const json=data(raw,'canonicalJson'),hash=data(raw,'sha256');
 if(typeof json!=='string'||typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))invalid();
 const bytes=Buffer.from(json);if(bytes.length>limit)invalid();const size=Buffer.alloc(8);size.writeBigUInt64BE(BigInt(bytes.length));
 if(createHash('sha256').update(domain).update(size).update(bytes).digest('hex')!==hash)invalid();
 const value:unknown=parse(json);
 exact(value,['kind','observation','sourceKind','poolScope','profile','schemaVersion','semanticDigest','poolId','ownerUid','schema','sourceIdentity','tables']);
 const v=value as Record<string,unknown>;
 if(v.kind!=='original_root_nmp_ledger_v1'||v.observation!=='history-observation-only'||v.poolScope!=='account-global'||(v.sourceKind!=='live-session'&&v.sourceKind!=='existing-ordinary-readonly'))invalid();
 const protectedIO=v.schemaVersion===4;
 if((v.schemaVersion!==3&&!protectedIO)||v.profile!==(protectedIO?'ordinary_runtime_root_resource_reservation_writer_v8_protected_io':'ordinary_runtime_root_resource_reservation_writer_v7')||v.semanticDigest!==(protectedIO?'8dc149dce2d161efe6805547451be7284377b3157510cfd60f6717defd528c59':'803ead1653ac39ab8b82226ec500cebf76916c3635e4c12e2c6122a53788b780')||typeof v.poolId!=='string'||!/^[a-f0-9]{64}$/.test(v.poolId)||typeof v.ownerUid!=='string'||!/^(?:0|[1-9][0-9]*)$/.test(v.ownerUid))invalid();
 exact(v.sourceIdentity,['kind','facts']);const identity=v.sourceIdentity as Record<string,unknown>;
 if(identity.kind!==(protectedIO?'protected-anchor-birth-audit-v2':'ordinary-current-files-v1')||!Array.isArray(identity.facts)||identity.facts.length!==3)invalid();
 for(let i=0;i<identity.facts.length;i++){const fact:unknown=identity.facts[i];if(!Array.isArray(fact)||fact.length!==5)invalid();for(let j=0;j<fact.length;j++)if(typeof fact[j]!=='string'||!/^(?:0|[1-9][0-9]*)$/.test(fact[j])||BigInt(fact[j])>=(1n<<64n))invalid();freeze(fact);}freeze(identity.facts);freeze(identity);
 rows(v.schema,4);if(!Array.isArray(v.tables)||v.tables.length!==(protectedIO?10:9))invalid();
 for(let i=0;i<v.tables.length;i++){
  const table:unknown=v.tables[i];exact(table,['name','columns','rows']);const t=table as Record<string,unknown>;
  const expected=columns[i]!;if(t.name!==names[i]||!Array.isArray(t.columns)||t.columns.length!==expected.length)invalid();
  for(let j=0;j<expected.length;j++)if(t.columns[j]!==expected[j])invalid();
  rows(t.rows,expected.length);freeze(t.columns);freeze(t);
 }freeze(v.tables);return freeze(v) as unknown as OriginalRootNmpLedger;
}
function method(api:unknown,name:string):Function{const fn=data(api,name);if(typeof fn!=='function'||isProxy(fn))invalid();return fn;}
/** Fixed existing-only OS-account Native source; no path, SQL or issuer input.
 * Missing/legacy/busy/hot-journal remains a typed refusal, never fresh genesis. */
export function captureExistingOriginalRootNmpLedger():OriginalRootNmpLedger{
 if(process.platform!=='darwin')throw Error('ROOT_RESOURCE_PLATFORM_UNAVAILABLE');
 const api=loadOriginalRootLedgerSource();return decodeOriginalRootNmpLedger(apply(method(api,'captureExistingOriginalRootPoolLedger'),api,[]));
}
/** Negative source custody remains reachable without positive Source current. */
export function closeExistingOriginalRootNmpLedgerSource():void{
 if(process.platform!=='darwin')throw Error('ROOT_RESOURCE_PLATFORM_UNAVAILABLE');
 const api=loadOriginalRootLedgerSource();const raw=apply(method(api,'closeOriginalRootPoolLedgerSource'),api,[]);if(raw!==undefined)invalid();
}
