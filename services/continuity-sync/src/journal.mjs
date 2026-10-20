import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonical,hash,identifier,integer,parseCanonical } from './crypto.mjs';
import { privateDirectory,privateFile,syncDirectory } from './private-files.mjs';

function decode(value){return parseCanonical(Buffer.from(value));}
function immutable(value){if(value&&typeof value==='object'){for(const child of Object.values(value))immutable(child);Object.freeze(value);}return value;}
function unavailable(){return new Error('authority_unavailable');}
function configure(db){db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA fullfsync=ON; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA secure_delete=ON;');}
function disclosure(disclosureClass,scopeDigest){if(!['private','scope-private','global-control'].includes(disclosureClass)||(disclosureClass==='scope-private'?typeof scopeDigest!=='string'||!/^[a-f0-9]{64}$/.test(scopeDigest):scopeDigest!==null))throw new Error('invalid_disclosure_class');}
export function journalCommitment(entry){
  const {hash:_,...body}=entry;
  return {schemaVersion:2,identityHash:body.identityHash,sequence:body.sequence,previousHash:body.previousHash,operationId:body.operationId,kind:body.kind,recordType:body.recordType,disclosureClass:body.disclosureClass,scopeDigest:body.scopeDigest,requestHash:body.requestHash,entryHash:hash(body)};
}

/** A single synchronous owner for the control journal. Witness advances can never be undone to repair body state. */
export class AuthorityJournal {
  #body;#witness;#owner;#identityHash;#genesis;#poisoned=false;#closed=false;#inTransaction=false;#fault;
  constructor({stateDir,witnessDir,identity,initialize=false,fault=()=>{}}){
    this.#fault=fault;this.#identityHash=hash(identity);this.#genesis=hash(['xiaok/context-sync/authority-genesis/v2',identity]);
    try{
      const state=privateDirectory(stateDir),witness=privateDirectory(witnessDir);
      const relative=path.relative(state,witness);
      if(state===witness||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw unavailable();
      const ownerPath=path.join(witness,'.owner.sqlite');
      privateFile(ownerPath,{create:!fs.existsSync(ownerPath)});
      this.#owner=new DatabaseSync(ownerPath,{timeout:0});
      try{this.#owner.exec('PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE;');}catch{throw new Error('owner_unavailable');}
      const bodyPath=path.join(state,'authority.sqlite'),witnessPath=path.join(witness,'heads.sqlite');
      if(initialize){
        if(fs.readdirSync(state).length||fs.readdirSync(witness).some(x=>!['.owner.sqlite','.owner.sqlite-journal'].includes(x)))throw unavailable();
        privateFile(bodyPath,{create:true});privateFile(witnessPath,{create:true});
      }else{privateFile(bodyPath);privateFile(witnessPath);}
      this.#body=new DatabaseSync(bodyPath,{timeout:0});this.#witness=new DatabaseSync(witnessPath,{timeout:0});
      configure(this.#body);configure(this.#witness);
      if(initialize){
        this.#body.exec(`BEGIN IMMEDIATE; PRAGMA user_version=2;
          CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
          CREATE TABLE control(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
          CREATE TABLE authority_journal(sequence INTEGER PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE,entry TEXT NOT NULL,hash TEXT NOT NULL) STRICT;`);
        this.#body.prepare('INSERT INTO metadata VALUES (?,?)').run('identity',canonical(identity));
        this.#witness.exec('BEGIN IMMEDIATE; PRAGMA user_version=2; CREATE TABLE head(id INTEGER PRIMARY KEY CHECK(id=1),identity_hash TEXT NOT NULL,sequence INTEGER NOT NULL,hash TEXT NOT NULL) STRICT;');
        this.#witness.prepare('INSERT INTO head VALUES (1,?,?,?)').run(this.#identityHash,0,this.#genesis);
        this.#witness.exec('COMMIT');this.#body.exec('COMMIT');syncDirectory(state);syncDirectory(witness);
      }
      if(this.#body.prepare('PRAGMA user_version').get().user_version!==2||this.#witness.prepare('PRAGMA user_version').get().user_version!==2)throw unavailable();
      if(this.#body.prepare('SELECT value FROM metadata WHERE key=?').get('identity')?.value!==canonical(identity))throw unavailable();
      this.#verifyJournal();this.#assertCurrent();
    }catch(e){this.close();if(e.message==='owner_unavailable')throw e;throw new Error('authority_unavailable',{cause:e});}
  }
  #rawHead(){const r=this.#body.prepare('SELECT sequence,hash FROM authority_journal ORDER BY sequence DESC LIMIT 1').get();return r?{sequence:r.sequence,hash:r.hash}:{sequence:0,hash:this.#genesis};}
  #assertCurrent(){
    if(this.#closed||this.#poisoned)throw unavailable();
    try{
      if(this.#owner?.isOpen!==true||this.#owner.isTransaction!==true)throw unavailable();
      const a=this.#rawHead(),b=this.#witness.prepare('SELECT identity_hash,sequence,hash FROM head WHERE id=1').get();
      if(!b||b.identity_hash!==this.#identityHash||a.sequence!==b.sequence||a.hash!==b.hash)throw unavailable();
    }catch{this.#poisoned=true;throw unavailable();}
  }
  #verifyJournal(){
    const controls=new Map();let sequence=0,previousHash=this.#genesis;
    for(const row of this.#body.prepare('SELECT * FROM authority_journal ORDER BY sequence').iterate()){
      const entry=decode(row.entry);
      identifier(entry.recordType);disclosure(entry.disclosureClass,entry.scopeDigest);
      if(entry.schemaVersion!==2||row.sequence!==++sequence||entry.sequence!==sequence||entry.previousHash!==previousHash||row.operation_id!==entry.operationId||hash(journalCommitment(entry))!==row.hash||entry.identityHash!==this.#identityHash||hash({kind:entry.kind,request:entry.request})!==entry.requestHash)throw unavailable();
      for(const change of entry.changes)change.deleted?controls.delete(change.key):controls.set(change.key,canonical(change.value));
      previousHash=row.hash;
    }
    const current=this.#body.prepare('SELECT key,value FROM control ORDER BY key').all();
    if(current.length!==controls.size||current.some(r=>controls.get(r.key)!==r.value))throw unavailable();
  }
  head(){this.#assertCurrent();return {...this.#rawHead(),identityHash:this.#identityHash};}
  /** Original readonly replay, including physical row metadata and ALL control
   * rows. Undefined is not a publication/source capability. */
  assertReplayCurrent(){
    try{this.#assertCurrent();this.#verifyJournal();this.#assertCurrent();}
    catch{this.#poisoned=true;throw unavailable();}
  }
  get(key){this.#assertCurrent();const r=this.#body.prepare('SELECT value FROM control WHERE key=?').get(key);return r?decode(r.value):undefined;}
  getDecision(operationId){this.#assertCurrent();const r=this.#body.prepare('SELECT entry,hash FROM authority_journal WHERE operation_id=?').get(operationId);return r?{...decode(r.entry),hash:r.hash}:undefined;}
  readJournal(after=0,limit=100){this.#assertCurrent();integer(after);integer(limit,1);if(limit>100||after>this.#rawHead().sequence)throw new Error('invalid_page');return this.#body.prepare('SELECT entry,hash FROM authority_journal WHERE sequence>? ORDER BY sequence LIMIT ?').all(after,limit).map(r=>({...decode(r.entry),hash:r.hash}));}
  readCommitments(after=0,limit=100){return this.readJournal(after,limit).map(entry=>({...journalCommitment(entry),hash:entry.hash}));}
  transact({operationId,kind,request,recordType=kind,disclosureClass='private',scopeDigest=null},apply){
    this.#assertCurrent();if(this.#inTransaction)throw new Error('nested_authority_transaction');identifier(operationId);identifier(kind);
    identifier(recordType);disclosure(disclosureClass,scopeDigest);request=immutable(decode(canonical(request)));
    const requestHash=hash({kind,request}),existing=this.getDecision(operationId);
    if(existing){if(existing.requestHash!==requestHash||existing.recordType!==recordType||existing.disclosureClass!==disclosureClass||existing.scopeDigest!==scopeDigest)throw new Error('operation_conflict');return existing;}
    let witnessAttempted=false,bodyActive=false,witnessActive=false;this.#inTransaction=true;
    try{
      this.#body.exec('BEGIN IMMEDIATE');bodyActive=true;this.#assertCurrent();const base=this.#rawHead(),changes=new Map();let active=true;
      const check=key=>{if(!active||typeof key!=='string'||key.length<1||key.length>512)throw new Error('invalid_control_key');};
      const tx=Object.freeze({
        get:key=>{check(key);const r=this.#body.prepare('SELECT value FROM control WHERE key=?').get(key);return r?decode(r.value):undefined;},
        set:(key,value)=>{check(key);const encoded=canonical(value);this.#body.prepare('INSERT INTO control VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,encoded);changes.set(key,{key,deleted:false,value:decode(encoded)});},
        delete:key=>{check(key);this.#body.prepare('DELETE FROM control WHERE key=?').run(key);changes.set(key,{key,deleted:true});},
      });
      let result;try{result=apply(tx,request);}finally{active=false;}
      const entry={schemaVersion:2,identityHash:this.#identityHash,sequence:base.sequence+1,previousHash:base.hash,operationId,requestHash,kind,recordType,disclosureClass,scopeDigest,request,result,changes:[...changes.values()].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0)};
      const encoded=canonical(entry),eventHash=hash(journalCommitment(entry));
      this.#body.prepare('INSERT INTO authority_journal VALUES (?,?,?,?)').run(entry.sequence,operationId,encoded,eventHash);
      this.#fault('body_prepared');
      this.#witness.exec('BEGIN IMMEDIATE');witnessActive=true;
      const changed=this.#witness.prepare('UPDATE head SET sequence=?,hash=? WHERE id=1 AND identity_hash=? AND sequence=? AND hash=?').run(entry.sequence,eventHash,this.#identityHash,base.sequence,base.hash);
      if(changed.changes!==1){this.#poisoned=true;throw unavailable();}
      witnessAttempted=true;this.#witness.exec('COMMIT');witnessActive=false;this.#fault('witness_committed');
      this.#body.exec('COMMIT');bodyActive=false;this.#fault('body_committed');this.#assertCurrent();
      return {...decode(encoded),hash:eventHash};
    }catch(e){
      if(witnessAttempted)this.#poisoned=true;
      if(bodyActive)try{this.#body.exec('ROLLBACK');}catch{this.#poisoned=true;}
      if(witnessActive)try{this.#witness.exec('ROLLBACK');}catch{this.#poisoned=true;}
      if(this.#poisoned)throw unavailable();throw e;
    }finally{this.#inTransaction=false;}
  }
  close(){if(this.#closed)return;this.#closed=true;for(const db of [this.#body,this.#witness,this.#owner])if(db){try{db.exec('ROLLBACK');}catch{}try{db.close();}catch{}}}
}
