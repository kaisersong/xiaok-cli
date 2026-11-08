import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {mkdtempSync,realpathSync,mkdirSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join} from 'node:path';
const scope=vi.hoisted(()=>({home:'',route:'ordinary'}));
vi.mock('node:os',async load=>{const actual=await load<typeof import('node:os')>();return {...actual,userInfo:()=>({...actual.userInfo(),homedir:scope.home})};});
vi.mock('../../../src/runtime/verification/migration-markers.js',async load=>({...await load<typeof import('../../../src/runtime/verification/migration-markers.js')>(),readInstalledCurrentProfile:()=>({kind:scope.route})}));
import {HarnessOptimizationStore,readOriginalHarnessBudgetStoreWriterFate} from '../../../desktop/electron/harness-optimization-store.js';
import {DEFAULT_HARNESS_OPTIMIZATION_CONFIG} from '../../../desktop/electron/harness-optimization-config.js';
import {readOrdinaryProfileSources} from '../../../src/runtime/verification/ordinary-profile-source-registry.js';
const root=realpathSync(mkdtempSync(join(tmpdir(),'budget-source-'))),oldConfig=process.env.XIAOK_CONFIG_DIR;
beforeAll(()=>{scope.home=join(root,'account');mkdirSync(scope.home,{mode:0o700});process.env.XIAOK_CONFIG_DIR=join(scope.home,'.xiaok');});
afterAll(()=>{if(oldConfig===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=oldConfig;rmSync(root,{recursive:true,force:true});});
function data(directory:string,initializing=true){const stat=statSync(directory,{bigint:true});return {dbPath:join(directory,'harness-optimization.sqlite'),root:directory,identity:`${stat.dev}:${stat.ino}`,ownerId:'original-owner',initOperationId:'original-init',initializing,now:1000,defaultConfig:structuredClone(DEFAULT_HARNESS_OPTIMIZATION_CONFIG),profileId:'original-profile',workspaceId:'original-workspace'};}
it.skipIf(process.platform==='win32')('discovers the original persistent budget Worker before public ready and preserves cold bytes',async()=>{
 const directory=join(root,'ordinary');mkdirSync(directory);const input=data(directory);let store=new HarnessOptimizationStore(input,()=>{});
 try{await store.ready;const facts=readOrdinaryProfileSources();const found=facts?.sources.find(s=>s.database?.basename===basename(input.dbPath)&&s.directory.canonicalPath===dirname(input.dbPath));expect(found?.snapshotFormat).toBe('harness-budget-sqlite-v1');expect(found!.database!.inode).toBe(String(statSync(input.dbPath,{bigint:true}).ino));expect(facts!.legacyInventoryRequired).toBe(true);expect(facts).not.toHaveProperty('enumerationComplete');}finally{await store.dispose();}
 const before=readOrdinaryProfileSources();store=new HarnessOptimizationStore(data(directory,false),()=>{});try{await store.ready;expect(await store.call('read')).toMatchObject({ownerId:'original-owner'});expect(readOrdinaryProfileSources()!.generation).toBe(before!.generation);}finally{await store.dispose();}
});
it.each(['protected','unavailable'])('refuses ordinary budget Worker on %s routing before its constructor',async route=>{
 const directory=join(root,route);mkdirSync(directory);const input=data(directory);scope.route=route;let store:HarnessOptimizationStore|undefined;
 try{expect(()=>{store=new HarnessOptimizationStore(input,()=>{});}).toThrow('ordinary_source_route');}finally{scope.route='ordinary';if(store){await store.ready.catch(()=>{});await store.dispose();}}
});

it('keeps one physical close Promise and only reports the actual original Worker terminated',async()=>{
 const directory=join(root,'fate');mkdirSync(directory);const store=new HarnessOptimizationStore(data(directory),()=>{});await store.ready;
 const fact=readOriginalHarnessBudgetStoreWriterFate(store);expect(fact.path).toBe(join(directory,'harness-optimization.sqlite'));expect(()=>fact.assertTerminated()).toThrow('budget_source_physical_unconfirmed');
 let traps=0;const foreign=new Proxy({},{get(){traps++;throw Error('getter');},getOwnPropertyDescriptor(){traps++;throw Error('descriptor');}});
 expect(()=>readOriginalHarnessBudgetStoreWriterFate(foreign)).toThrow('original_budget_store_required');expect(()=>readOriginalHarnessBudgetStoreWriterFate({...store})).toThrow('original_budget_store_required');expect(traps).toBe(0);
 const first=store.dispose();expect(store.dispose()).toBe(first);await first;expect(()=>fact.assertTerminated()).not.toThrow();await expect(store.call('read')).rejects.toThrow('optimization_store_unavailable');
});

import Database from 'better-sqlite3';
import {compileBudgetCustody,createOriginalBudgetVersion,createOriginalUnknownBudget} from '../../support/harness-budget-source-fixture.js';
import {startProfileSourceCapture,readProfileSqliteLosslessRows,readProfileSqliteSchema} from '../../../src/runtime/verification/profile-source-capture.js';
import {iterateCapturedSQLiteBudgetSources} from '../../../src/runtime/verification/captured-sqlite-budget.js';
import {iterateCapturedProfileDeclarations} from '../../../src/runtime/verification/captured-profile-mapper.js';
const posix=process.platform!=='win32';let tools:ReturnType<typeof compileBudgetCustody>,serial=0;
beforeAll(()=>{if(posix)tools=compileBudgetCustody(root);},30000);
function file(){return join(root,'capture-'+serial++,'harness-optimization.sqlite');}
async function captured(path:string,work:(owner:object,token:object)=>Promise<void>|void){
 const found=readOrdinaryProfileSources()!.sources.find(s=>s.directory.canonicalPath===dirname(path)&&s.database?.basename===basename(path))!;expect(found).toBeDefined();
 const owner=await startProfileSourceCapture({uid:process.getuid!(),...tools,sources:[{sourceId:found.sourceId,kind:'sqlite-db',snapshotFormat:'harness-budget-sqlite-v1',directory:found.directory,database:found.database!}],signal:new AbortController().signal});try{await work(owner,await owner.capture());}finally{await owner.close();}
}
const variants=[[1,false],[2,false],[3,false],[4,true],[5,false],[5,true],[6,true],[7,true],[8,true],[9,true]] as const;
it.skipIf(!posix).each(variants)('captures the original budget schema %s/source=%s and every raw ledger/receipt table',async(version,source)=>{
 const path=file();await createOriginalBudgetVersion(path,version,source);await captured(path,async(owner,token)=>{
  const events=[...iterateCapturedSQLiteBudgetSources(owner,token)],end=events.find(e=>e.kind==='source-end')!;expect(end.kind).toBe('source-end');if(end.kind!=='source-end')throw Error('end');expect(Object.keys(end.counts).length).toBeGreaterThanOrEqual(12);
  const db=new Database(path);try{for(const [id,count]of Object.entries(end.counts)){const table=id.split(':')[1]!;const raw=db.prepare('SELECT rowid AS original_rowid,* FROM "'+table+'" ORDER BY rowid').safeIntegers().all() as Record<string,unknown>[];expect(count).toBe(raw.length);const rows=events.filter(e=>e.kind==='row'&&e.table===table);expect(rows.map(e=>e.kind==='row'?e.rowid:'')).toEqual(raw.map(r=>String(r.original_rowid)));for(const row of rows)if(row.kind==='row'){const original=raw.find(r=>String(r.original_rowid)===row.rowid)!;for(const [name,cell]of Object.entries(row.record)){if(cell.type==='text')expect(cell.value).toBe(original[name]);else if(cell.type==='integer')expect(cell.value).toBe(String(original[name]));else if(cell.type==='null')expect(original[name]).toBeNull();}}}}finally{db.close();}
  expect(events.at(-1)?.kind).toBe('complete');const mapped=[];for await(const event of iterateCapturedProfileDeclarations(owner,token))mapped.push(event);expect(mapped.at(-1)?.kind).toBe('complete');expect(mapped.some(e=>e.kind==='gap'&&e.reason==='unsupported-semantic'&&e.origin.path.endsWith('.value'))).toBe(true);expect(mapped.at(-1)).not.toHaveProperty('authority');expect(readOrdinaryProfileSources()!.legacyInventoryRequired).toBe(true);
 });
});
it.skipIf(!posix)('preserves exact budget raw JSON and lossless scalar representations without turning them into costs',async()=>{
 const path=file();await createOriginalBudgetVersion(path,1);const db=new Database(path),json=' { "unsafePermit" : true, "amount" : 9007199254740993 } ';
 try{db.prepare('INSERT INTO outbox VALUES(?,?)').run('raw',json);db.prepare('INSERT INTO outbox VALUES(?,?)').run('integer',9223372036854775807n);db.prepare('INSERT INTO outbox VALUES(?,?)').run('real',1.25);db.prepare('INSERT INTO outbox VALUES(?,?)').run('blob',Buffer.from([0,255]));db.prepare('INSERT INTO forward_steps VALUES(?,?,?,?,?)').run('integer',9223372036854775807n,1,1,0);db.prepare('INSERT INTO forward_steps VALUES(?,?,?,?,?)').run('real',1.25,1,1,0);db.prepare('INSERT INTO forward_steps VALUES(?,?,?,?,?)').run('blob',Buffer.from([0,255]),1,1,0);}finally{db.close();}
 await captured(path,(owner,token)=>{const rows=[...iterateCapturedSQLiteBudgetSources(owner,token)].filter(e=>e.kind==='row'&&e.table==='outbox');expect(rows.map(e=>e.kind==='row'?e.record.body:null)).toEqual([{type:'text',value:json},{type:'text',value:'9223372036854775807'},{type:'text',value:'1.25'},{type:'blob',value:'AP8='}]);const scalars=[...iterateCapturedSQLiteBudgetSources(owner,token)].filter(e=>e.kind==='row'&&e.table==='forward_steps').map(e=>e.kind==='row'?e.record.beforeMark:null);expect(scalars).toEqual([{type:'integer',value:'9223372036854775807'},{type:'real',value:'3ff4000000000000'},{type:'blob',value:'AP8='}]);});
});
it.skipIf(!posix).each(['table','column','index','trigger','metadata'])('refuses unknown original budget %s before complete',async mode=>{
 const path=file();await createOriginalBudgetVersion(path,1);const db=new Database(path);try{if(mode==='table')db.exec('CREATE TABLE hidden(x)');else if(mode==='column')db.exec('ALTER TABLE outbox ADD COLUMN hidden TEXT');else if(mode==='index')db.exec('CREATE INDEX hidden ON outbox(body)');else if(mode==='trigger')db.exec('CREATE TRIGGER hidden AFTER UPDATE ON outbox BEGIN SELECT 1; END');else db.exec("UPDATE metadata SET value='9' WHERE key='schemaVersion'");}finally{db.close();}
 await captured(path,(owner,token)=>{const seen:string[]=[];expect(()=>{for(const event of iterateCapturedSQLiteBudgetSources(owner,token))seen.push(event.kind);}).toThrow();expect(seen).not.toContain('complete');});
});
it.skipIf(!posix)('holds original membership, fixed query ABI and closes early budget iterators',async()=>{
 const path=file();await createOriginalBudgetVersion(path,1);await captured(path,async(owner,token)=>{expect(()=>[...iterateCapturedSQLiteBudgetSources({...owner},token)]).toThrow('brand');const first=iterateCapturedSQLiteBudgetSources(owner,token);expect(first.next().value!.kind).toBe('source-start');first.next();first.return();const source=readOrdinaryProfileSources()!.sources.find(s=>s.directory.canonicalPath===dirname(path))!;expect(readProfileSqliteSchema(owner,token,source.sourceId).length).toBeGreaterThan(0);expect(()=>[...readProfileSqliteLosslessRows(owner,token,source.sourceId,'state_entities')]).toThrow('query_format');});
});

it.skipIf(!posix)('reads original unknown attempts and held funds without refunding or creating a replacement account',async()=>{
 const path=file();await createOriginalUnknownBudget(path);const db=new Database(path);let before:unknown;
 try{before={accounts:db.prepare('SELECT * FROM dsh_budget_accounts').all(),attempts:db.prepare('SELECT * FROM dsh_budget_attempts').all()};expect(before).toMatchObject({accounts:[{held_tokens:400,held_cost:600,spent_tokens:0,spent_cost:0}],attempts:[{state:'unknown'}]});}finally{db.close();}
 await captured(path,(owner,token)=>{const rows=[...iterateCapturedSQLiteBudgetSources(owner,token)].filter(e=>e.kind==='row'),account=rows.find(e=>e.kind==='row'&&e.table==='dsh_budget_accounts')!,attempt=rows.find(e=>e.kind==='row'&&e.table==='dsh_budget_attempts')!;expect(account.kind==='row'&&account.record.held_tokens).toEqual({type:'integer',value:'400'});expect(account.kind==='row'&&account.record.held_cost).toEqual({type:'integer',value:'600'});expect(attempt.kind==='row'&&attempt.record.state).toEqual({type:'text',value:'unknown'});});
 const after=new Database(path);try{expect({accounts:after.prepare('SELECT * FROM dsh_budget_accounts').all(),attempts:after.prepare('SELECT * FROM dsh_budget_attempts').all()}).toEqual(before);}finally{after.close();}
});
it.skipIf(!posix)('independently rejects omission of a raw budget semantic cell from the real mapper',async()=>{
 const path=file();await createOriginalBudgetVersion(path,1);const {CapturedProfileRelations}=await import('../../../src/runtime/verification/captured-profile-relations.js'),original=CapturedProfileRelations.prototype.complex;
 await captured(path,async(owner,token)=>{const spy=vi.spyOn(CapturedProfileRelations.prototype,'complex').mockImplementation(function(this:InstanceType<typeof CapturedProfileRelations>,value,origin){if(origin.path==='metadata[1].value')return;return original.call(this,value,origin);});const seen:Array<{kind:string}>=[];try{await expect((async()=>{for await(const event of iterateCapturedProfileDeclarations(owner,token))seen.push(event);})()).rejects.toThrow('unprojected_slot');expect(seen.some(e=>e.kind==='complete')).toBe(false);}finally{spy.mockRestore();}});
});
it('keeps the existing Windows ordinary absence branch without publishing POSIX budget inventory',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(process,'platform')!,directory=join(root,'windows');mkdirSync(directory);const before=readOrdinaryProfileSources();Object.defineProperty(process,'platform',{...descriptor,value:'win32'});let store:HarnessOptimizationStore|undefined;
 try{store=new HarnessOptimizationStore(data(directory),()=>{});await store.ready;expect(readOrdinaryProfileSources()).toEqual(before);}finally{await store?.dispose();Object.defineProperty(process,'platform',descriptor);}
});
