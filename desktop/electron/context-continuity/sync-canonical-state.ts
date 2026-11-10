import {createHash} from 'node:crypto';
import {types} from 'node:util';
import type {DatabaseSync} from 'node:sqlite';

export type CanonicalStickyFact={kind:'grant'|'scope'|'message'|'reference'|'external-reader';id:string;revision:number}
 |{kind:'dependency';table:'context_dependencies'|'task_history_dependencies'|'effect_history_dependencies';taskId:string;sourceId:string;revision:number};
export interface CanonicalStoreState {policyHash:string;publicationHash:string;stickyFacts:CanonicalStickyFact[]}
const unavailable=()=>new Error('canonical_store_state_unavailable');
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const subject=(kind:string,id:string)=>hash(['xiaok/canonical-sticky-subject/v1',kind,id]);
const quote=(name:string)=>'"'+name.replaceAll('"','""')+'"';
const policyTables=new Set(['conversations','source_bindings','message_anchors','archive_visibilities','legacy_claims','source_cursors','source_event_digests',
 'context_refs','context_ref_entries','read_grants','task_bindings','task_public_inputs','task_presentation_sources','guarded_effect_runs','effect_owner_receipts','effect_history_dependencies','unproven_effects','source_settlements','native_context_fences','projection_failures',
 'context_dependencies','task_history_dependencies','history_search_consents','history_search_managed_grants','external_readers','external_reader_refs','external_reader_dependencies']);

/** Exact actual SQLite snapshot DATA only. Neither its hashes nor typed negative
 * facts prove a stage, authentication, original ownership or a successful COMMIT.
 * All semantic tables (including source cursors, operation provenance and future
 * native resource tables) enter the publication hash. Only the self-referential
 * sync head's VALUES are omitted; its schema remains in the hash. */
export function captureCanonicalStoreState(db:DatabaseSync):CanonicalStoreState{return captureState(db);}

export interface CanonicalSourceIntentRow {readonly kind:string;readonly id:string;readonly request_hash:string;readonly result:string}
/** Prospective exact one-row DATA delta, never stage/COMMIT/source authority. */
export function captureCanonicalStoreStateWithSourceIntent(db:DatabaseSync,input:unknown):CanonicalStoreState{
 if(!input||typeof input!=='object'||types.isProxy(input)||Object.getOwnPropertySymbols(input).length||![Object.prototype,null].includes(Object.getPrototypeOf(input)))throw unavailable();
 const fields=Object.getOwnPropertyDescriptors(input),names=['kind','id','request_hash','result'];
 if(Object.keys(fields).length!==names.length)throw unavailable();
 const row:Record<string,string>={};for(const name of names){const field=fields[name];if(!field?.enumerable||!('value'in field)||typeof field.value!=='string')throw unavailable();row[name]=field.value;}
 if(!['canonicalSourceBootstrapV1','canonicalSourceReconcileV1'].includes(row.kind)||!/[a-f0-9]{64}/.test(row.id)||row.id.length!==64||!/[a-f0-9]{64}/.test(row.request_hash)||row.request_hash.length!==64||Buffer.byteLength(row.result)>65536)throw unavailable();
 try{const value=JSON.parse(row.result);if(!value||typeof value!=='object'||Array.isArray(value))throw unavailable();}catch{throw unavailable();}
 return captureState(db,Object.freeze(row)as unknown as CanonicalSourceIntentRow);
}
function captureState(db:DatabaseSync,sourceIntent?:CanonicalSourceIntentRow):CanonicalStoreState {
 const ownRead=!db.isTransaction;let opened=false;
 try{
  if(ownRead){db.exec('BEGIN DEFERRED');opened=true;}
  let bytes=0,rows=0;
  const count=(value:string)=>{bytes+=Buffer.byteLength(value);if(bytes>32*1024*1024)throw unavailable();};
  const schema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all();
  if(schema.length>4096)throw unavailable();count(JSON.stringify(schema));
  const tables=schema.filter(row=>row.type==='table');if(tables.length>128)throw unavailable();
  const publication=createHash('sha256'),policy=createHash('sha256');
  const schemaText=JSON.stringify(['xiaok/canonical-store-schema/v1',schema]);publication.update(schemaText);policy.update(schemaText);
  const tableNames=new Set(tables.map(row=>String(row.name)));
  for(const required of ['continuity_meta','conversations','message_anchors','message_versions','read_grants','context_dependencies','task_history_dependencies','effect_history_dependencies','external_readers'])if(!tableNames.has(required))throw unavailable();
  const values=(row:Record<string,unknown>,columns:string[])=>columns.map(name=>{
   const value=row[name];if(value===null)return ['null'];
   if(typeof value==='string'){count(value);return ['text',value];}
   if(typeof value==='number'&&Number.isFinite(value))return ['number',value];
   if(typeof value==='bigint')return ['integer',value.toString()];
   if(value instanceof Uint8Array){count(Buffer.from(value).toString('base64'));return ['blob',Buffer.from(value).toString('base64')];}
   throw unavailable();
  });
  for(const table of tables){
   const name=String(table.name),columns=db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(row=>String(row.name));
   if(!columns.length||columns.length>128)throw unavailable();
   if(name==='sync_store_state'){
    if(columns.join(',')!=='key,value')throw unavailable();continue;
   }
   const statement=db.prepare(`SELECT * FROM ${quote(name)}`);statement.setReadBigInts(true);
   const encoded:string[]=[];
   for(const row of statement.iterate()){
    if(++rows>50000)throw unavailable();
    // Secret cursor material does not define canonical policy/content. Every
    // other meta row, including persistent UUID/profile/schema, is included.
    if(name==='continuity_meta'&&row.key==='cursorKey')continue;
    const item=JSON.stringify(values(row,columns));count(item);encoded.push(item);
   }
   if(name==='operations'&&sourceIntent){
    if(columns.join(',')!=='kind,id,request_hash,result'||db.prepare('SELECT 1 FROM operations WHERE kind=? AND id=?').get(sourceIntent.kind,sourceIntent.id))throw unavailable();
    if(++rows>50000)throw unavailable();const item=JSON.stringify(values(sourceIntent as unknown as Record<string,unknown>,columns));count(item);encoded.push(item);
   }
   encoded.sort();const header=JSON.stringify(['table',name,columns]);publication.update(header);
   const relevant=policyTables.has(name)||name.startsWith('sync_')||name.startsWith('native_');if(relevant)policy.update(header);
   for(const item of encoded){publication.update(item);if(relevant)policy.update(item);}
  }
  const facts=new Map<string,CanonicalStickyFact>();
  const add=(fact:CanonicalStickyFact)=>{const key=JSON.stringify(fact.kind==='dependency'?[fact.kind,fact.table,fact.taskId,fact.sourceId]:[fact.kind,fact.id]),prior=facts.get(key);if(!Number.isSafeInteger(fact.revision)||fact.revision<1)throw unavailable();if(!prior||prior.revision<fact.revision)facts.set(key,fact);if(facts.size>8192)throw unavailable();};
  for(const row of db.prepare('SELECT id,revision FROM read_grants WHERE revoked<>0').iterate())add({kind:'grant',id:subject('grant',String(row.id)),revision:Number(row.revision)});
  for(const row of db.prepare('SELECT id,policy_revision FROM conversations WHERE deleted<>0').iterate())add({kind:'scope',id:subject('scope',String(row.id)),revision:Math.max(1,Number(row.policy_revision))});
  for(const row of db.prepare('SELECT id,latest_revision FROM message_anchors WHERE deleted<>0').iterate())add({kind:'message',id:subject('message',String(row.id)),revision:Number(row.latest_revision)});
  for(const row of db.prepare('SELECT id FROM external_readers WHERE revoked<>0').iterate())add({kind:'external-reader',id:subject('external-reader',String(row.id)),revision:1});
  for(const table of ['context_dependencies','task_history_dependencies','effect_history_dependencies']as const){
   const source=table==='context_dependencies'?'ref_id':'source_task_id';
   for(const row of db.prepare(`SELECT task_id,${source} AS source_id FROM ${table} WHERE valid=0`).iterate())add({kind:'dependency',table,taskId:subject('task',String(row.task_id)),sourceId:subject(source,String(row.source_id)),revision:1});
  }
  // External dependency invalidation and credential revocation are one original
  // policy mutation; either negative fact must survive a future old DB restore.
  for(const row of db.prepare('SELECT DISTINCT credential_id FROM external_reader_dependencies WHERE valid=0').iterate())add({kind:'external-reader',id:subject('external-reader',String(row.credential_id)),revision:1});
  if(tableNames.has('sync_revocations'))for(const row of db.prepare('SELECT kind,local_id,revision FROM sync_revocations').iterate()){
    const kind=row.kind==='conversation'||row.kind==='dependency'?'scope':row.kind;
    if(!['scope','message','reference','grant'].includes(String(kind)))throw unavailable();
    add({kind:kind as 'scope'|'message'|'reference'|'grant',id:subject(String(kind),String(row.local_id)),revision:Number(row.revision)});
  }
  const result={policyHash:policy.digest('hex'),publicationHash:publication.digest('hex'),stickyFacts:[...facts.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,fact])=>fact)};
  if(opened){db.exec('COMMIT');opened=false;}return result;
 }catch(error){if(opened){try{db.exec('ROLLBACK');}catch{/* data capture never grants authority */}}throw unavailable();}
}
