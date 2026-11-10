import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,renameSync,unlinkSync,existsSync,readdirSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareRootNmpLedgerFixture} from './helpers/root-nmp-ledger-fixture.mjs';
const mac={skip:process.platform!=='darwin'};
function setup(options){
 const p=prepareRootNmpLedgerFixture(options);process.env.XIAOK_CONFIG_DIR=join(p.root,'config');
 const api=createRequire(import.meta.url)(p.binary);
 console.log(JSON.stringify({kind:'root-nmp-ledger-prepared',root:p.root,artifactSha256:p.artifactSha256,factsSha256:p.factsSha256,compilerPids:p.records.map(r=>r.pid),productionQualified:false,gui:0}));
 return {p,api};
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function decode(raw){
 assert.ok(Object.isFrozen(raw));assert.deepEqual(Object.keys(raw),['kind','canonicalJson','sha256']);
 assert.equal(raw.kind,'original_root_nmp_ledger_capture_v1');const bytes=Buffer.from(raw.canonicalJson),length=Buffer.alloc(8);length.writeBigUInt64BE(BigInt(bytes.length));
 assert.equal(raw.sha256,createHash('sha256').update('xiaok.original-root-nmp-ledger/v1\0').update(length).update(bytes).digest('hex'));return JSON.parse(raw.canonicalJson);
}
function table(v,name){return v.tables.find(t=>t.name===name);}
const text=cell=>{assert.equal(cell[0],'text');return Buffer.from(cell[1],'hex').toString('utf8');};
function originalRows(file){const db=new DatabaseSync(file,{readOnly:true});try{return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(({name})=>({name,rows:db.prepare('SELECT * FROM '+name).all()}));}finally{db.close();}}
test('original Native RootNMP exposes fixed complete-ledger and existing-only source entries',mac,()=>{
 const {api}=setup();assert.deepEqual(['readOriginalRootPoolLedger','captureExistingOriginalRootPoolLedger','closeOriginalRootPoolLedgerSource'].filter(name=>typeof api[name]!=='function'),[]);
});
test('same original N5 held/queued/released/outbox/receipts survive full live and existing-only ledger cuts',mac,()=>{
 const {p,api}=setup(),file=join(p.domain,'root-resource-v1.sqlite');const session=api.openOriginal();let closed=false;
 try{
  api.installFresh(session);const queued=[],claims=[];
  for(let i=0;i<7;i++){
   queued.push(api.enqueue(session,api.fixtureSubject(session,i)));
   if(i<5){const claim=api.claimNext(session);claims.push(claim);api.consumeLaunch(session,claim.reservation);}
  }
  assert.equal(api.claimNext(session),null);assert.equal(api.finishOriginalRoot(session,claims[4].reservation).newlyFinished,true);
  api.cancelQueued(session,api.fixtureSubject(session,6));
  const before=readFileSync(file),rows=originalRows(file),policy=api.readPolicy(session);
  let setterCalls=0;Object.defineProperty(Object.prototype,'canonicalJson',{configurable:true,set(){setterCalls++;throw Error('setter');}});
  let live;try{live=decode(api.readOriginalRootPoolLedger(session));}finally{delete Object.prototype.canonicalJson;}
  assert.equal(setterCalls,0);assert.equal(live.sourceKind,'live-session');assert.equal(live.poolScope,'account-global');assert.equal(live.observation,'history-observation-only');
  assert.equal(live.tables.length,9);assert.equal(table(live,'root_resources').rows.length,7);assert.equal(table(live,'root_launch_outbox').rows.length,5);
  const states=table(live,'root_resources').rows.map(r=>text(r[8]));assert.equal(states.filter(s=>s==='reserved').length,4);assert.equal(states.filter(s=>s==='released').length,1);assert.equal(states.filter(s=>s==='queued').length,1);assert.equal(states.filter(s=>s==='cancelled_before_launch').length,1);
  assert.equal(table(live,'root_resource_receipts').rows.length,12);assert.equal(table(live,'root_physical_policy').rows.length,2);
  assert.deepEqual(api.readPolicy(session),policy);assert.deepEqual(originalRows(file),rows);assert.equal(sha(readFileSync(file)),sha(before));
  assert.throws(()=>api.captureExistingOriginalRootPoolLedger(),/ROOT_LEDGER_ISSUER_BUSY/);
  api.close(session);closed=true;
  const cold=decode(api.captureExistingOriginalRootPoolLedger());assert.equal(cold.sourceKind,'existing-ordinary-readonly');assert.equal(cold.poolId,live.poolId);assert.deepEqual(cold.tables,live.tables);assert.deepEqual(cold.schema,live.schema);
  assert.deepEqual(originalRows(file),rows);assert.equal(sha(readFileSync(file)),sha(before));api.closeOriginalRootPoolLedgerSource();
  assert.throws(()=>api.readOriginalRootPoolLedger(session),/CLOSED/);
  console.log(JSON.stringify({kind:'complete-original-ledger',root:p.root,poolId:live.poolId,nHeld:4,nQueued:1,nReleased:1,nCancelled:1,receipts:12,tables:9,dbSha256:sha(before),noNewCapability:true,mAndPPositiveNotCovered:true,ownChildrenRemaining:0}));
 }finally{if(!closed)api.close(session);}
});
test('unknown/copy/Proxy sources and caller arguments refuse without executing getters or changing the pool',mac,()=>{
 const {api}=setup(),s=api.openOriginal();try{api.installFresh(s);let traps=0;const proxy=new Proxy({},{get(){traps++;throw 0;},ownKeys(){traps++;throw 0;},getPrototypeOf(){traps++;throw 0;}});
  for(const value of [proxy,{},Object.create(s),{...s},null])assert.throws(()=>api.readOriginalRootPoolLedger(value),/SESSION/);
  assert.throws(()=>api.captureExistingOriginalRootPoolLedger(proxy),/ARGUMENT/);assert.throws(()=>api.closeOriginalRootPoolLedgerSource(proxy),/ARGUMENT/);assert.equal(traps,0);
  assert.equal(decode(api.readOriginalRootPoolLedger(s)).tables.length,9);
 }finally{api.close(s);}
});
test('missing existing-only source creates no file, and recovery sidecars are untouched typed refusals',mac,()=>{
 const {p,api}=setup();assert.deepEqual(readdirSync(p.domain),[]);assert.throws(()=>api.captureExistingOriginalRootPoolLedger(),/SOURCE_MISSING/);assert.deepEqual(readdirSync(p.domain),[]);
 const s=api.openOriginal();api.installFresh(s);api.close(s);const db=join(p.domain,'root-resource-v1.sqlite'),before=sha(readFileSync(db));
 for(const suffix of ['-journal','-wal','-shm']){const file=db+suffix;writeFileSync(file,Buffer.from('unconfirmed original sidecar'));const stat=lstatSync(file),bytes=readFileSync(file);assert.throws(()=>api.captureExistingOriginalRootPoolLedger(),/RECOVERY_REQUIRED/);assert.deepEqual(readFileSync(file),bytes);assert.equal(lstatSync(file).ino,stat.ino);assert.equal(sha(readFileSync(db)),before);unlinkSync(file);}
 assert.equal(decode(api.captureExistingOriginalRootPoolLedger()).tables.length,9);
});
test('an observed original path replacement remains sticky after the old path is restored',mac,()=>{
 const {p,api}=setup(),s=api.openOriginal();try{api.installFresh(s);const file=join(p.domain,'root-resource-v1.sqlite'),moved=file+'.retained';renameSync(file,moved);assert.throws(()=>api.readOriginalRootPoolLedger(s),/UNCONFIRMED/);renameSync(moved,file);assert.throws(()=>api.readOriginalRootPoolLedger(s),/UNCONFIRMED/);}finally{api.close(s);}
});
test('full original schema mismatch is not an empty ledger and the accepted live source cannot revive',mac,()=>{
 const {p,api}=setup(),s=api.openOriginal();let db;
 try{api.installFresh(s);db=new DatabaseSync(join(p.domain,'root-resource-v1.sqlite'));db.exec('CREATE TABLE unexpected_ledger_table(value BLOB)');assert.throws(()=>api.readOriginalRootPoolLedger(s),/LEDGER_UNCONFIRMED/);db.exec('DROP TABLE unexpected_ledger_table');assert.throws(()=>api.readOriginalRootPoolLedger(s),/SESSION_UNCONFIRMED/);}finally{db?.close();api.close(s);}
});
test('actual SQLite BUSY schema-reference close is retained and the same original negative close finalizes it',mac,()=>{
 const {p,api}=setup(),s=api.openOriginal();api.installFresh(s);const file=join(p.domain,'root-resource-v1.sqlite'),before=sha(readFileSync(file));api.fixtureHoldSchemaReference(s);
 assert.throws(()=>api.readOriginalRootPoolLedger(s),error=>{assert.equal(error.message,"ROOT_LEDGER_UNCONFIRMED");assert.equal(error.schemaReferenceCloseCode,5);return true;});assert.throws(()=>api.readOriginalRootPoolLedger(s),/SESSION_UNCONFIRMED/);
 assert.equal(api.close(s),undefined);assert.equal(sha(readFileSync(file)),before);assert.equal(decode(api.captureExistingOriginalRootPoolLedger()).tables.length,9);
 assert.equal(existsSync(file+'-journal'),false);
});

test('fixed TypeScript consumer decodes actual original Native bytes and refuses substituted projections',mac,async()=>{
 const {p,api}=setup(),reader=await import(pathToFileURL(p.reader).href);const s=api.openOriginal();
 try{api.installFresh(s);const raw=api.readOriginalRootPoolLedger(s),value=reader.decodeOriginalRootNmpLedger(raw);assert.equal(value.tables.length,9);assert.ok(Object.isFrozen(value)&&Object.isFrozen(value.tables)&&Object.isFrozen(value.tables[0].rows));
  let traps=0;const hostile=new Proxy(raw,{get(){traps++;throw 0;},ownKeys(){traps++;throw 0;}});assert.throws(()=>reader.decodeOriginalRootNmpLedger(hostile),/PROJECTION/);assert.equal(traps,0);
  assert.throws(()=>reader.decodeOriginalRootNmpLedger({...raw,sha256:'0'.repeat(64)}),/PROJECTION/);
  assert.throws(()=>reader.decodeOriginalRootNmpLedger({...raw,canonicalJson:raw.canonicalJson+' '}),/PROJECTION/);
 }finally{api.close(s);}
 const cold=reader.captureExistingOriginalRootNmpLedger();assert.equal(cold.sourceKind,'existing-ordinary-readonly');assert.equal(reader.closeExistingOriginalRootNmpLedgerSource(),undefined);
});

test('bounded ledger projection refuses rather than returning a partial or empty history',mac,()=>{
 const {api}=setup({smallLimit:true}),s=api.openOriginal();try{api.installFresh(s);const before=api.readPolicy(s);assert.throws(()=>api.readOriginalRootPoolLedger(s),/ROOT_LEDGER_LIMIT/);assert.deepEqual(api.readPolicy(s),before);}finally{api.close(s);}
});

test('historical unsupported floors and protected-without-source never become fresh or a partial ledger',mac,()=>{
 const {p,api}=setup(),file=join(p.domain,'root-resource-v1.sqlite');writeFileSync(join(p.domain,'issuer.lock'),'');
 const floors=[
  ['ordinary_runtime_root_resource_reservation_writer_v5',2,'92b39b7b584bb3f8dbb4ef450bae0b3fd06d01817d6b03dd43c05d293e57939b','xiaok_root_resource_reservation_writer_v4',/HISTORY_PROFILE_UNSUPPORTED/],
  ['ordinary_runtime_root_resource_reservation_writer_v6',2,'1e04b496364184acbdb96b17473e83356b1c70859da0d81c9409fc6eb6f0930f','xiaok_root_resource_reservation_writer_v5',/HISTORY_PROFILE_UNSUPPORTED/],
  ['ordinary_runtime_root_resource_reservation_writer_v8_protected_io',4,'8dc149dce2d161efe6805547451be7284377b3157510cfd60f6717defd528c59','xiaok_root_resource_reservation_writer_v7',/PROTECTED_SOURCE_REQUIRED/],
 ];
 for(const [profile,version,digest,guard,expected]of floors){
  const db=new DatabaseSync(file);try{db.exec('DROP TABLE IF EXISTS root_resource_floor;CREATE TABLE root_resource_floor(singleton INTEGER,profile TEXT,schema_version INTEGER,semantic_digest TEXT,guard_abi TEXT,issuer_epoch INTEGER)');db.prepare('INSERT INTO root_resource_floor VALUES(1,?,?,?,?,1)').run(profile,version,digest,guard);}finally{db.close();}
  const before=readFileSync(file);assert.throws(()=>api.captureExistingOriginalRootPoolLedger(),expected);assert.deepEqual(readFileSync(file),before);assert.equal(existsSync(file+'-journal'),false);
 }
});
