import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {mkdtempSync,realpathSync,mkdirSync,rmSync,statSync,existsSync,renameSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join} from 'node:path';
const scope=vi.hoisted(()=>({home:'',route:'ordinary'}));
vi.mock('node:os',async load=>{const actual=await load<typeof import('node:os')>();return {...actual,userInfo:()=>({...actual.userInfo(),homedir:scope.home})};});
vi.mock('../../../src/runtime/verification/migration-markers.js',async load=>({...await load<typeof import('../../../src/runtime/verification/migration-markers.js')>(),readInstalledCurrentProfile:()=>({kind:scope.route})}));
import {TimedActionStore} from '../../../desktop/electron/timed-action-store.js';
import {readOrdinaryProfileSources} from '../../../src/runtime/verification/ordinary-profile-source-registry.js';
const posix=process.platform!=='win32';
const root=realpathSync(mkdtempSync(join(tmpdir(),'timed-source-')));
beforeAll(()=>{scope.home=join(root,'account');mkdirSync(scope.home,{mode:0o700});process.env.XIAOK_CONFIG_DIR=join(scope.home,'.xiaok');});
afterAll(()=>rmSync(root,{recursive:true,force:true}));
it.skipIf(!posix)('discovers the original persistent timed constructor and cold data without hand registration',()=>{
 const directory=join(root,'source');mkdirSync(directory);const path=join(directory,'timed-actions.sqlite');let store=new TimedActionStore(path);
 try{store.createAction({id:'original-action',title:'original',trigger:{kind:'once',at:1000},executor:{kind:'agent_task',prompt:'not executed'},source:'user',now:500});}finally{store.close();}
 const first=readOrdinaryProfileSources()!;expect(first).toBeDefined();const found=first.sources.find(s=>s.database?.basename===basename(path)&&s.directory.canonicalPath===dirname(path));
 expect(found?.snapshotFormat).toBe('timed-actions-sqlite-v1');expect(found!.database!.inode).toBe(String(statSync(path,{bigint:true}).ino));expect(first.legacyInventoryRequired).toBe(true);
 store=new TimedActionStore(path);try{expect(store.listActions().map(a=>a.id)).toEqual(['original-action']);expect(store.getAutomationStoreVersion()).toBe(1);}finally{store.close();}
 expect(readOrdinaryProfileSources()!.generation).toBe(first.generation);
});

import Database from 'better-sqlite3';
import {compileTimedCustody,populateTimedStore} from '../../support/timed-action-source-fixture.js';
import {startProfileSourceCapture,readProfileSqliteSchema,readProfileSqliteLosslessRows,type ProfileCaptureSource} from '../../../src/runtime/verification/profile-source-capture.js';
import {iterateCapturedSQLiteTimedActionSources} from '../../../src/runtime/verification/captured-sqlite-timed-actions.js';
import {iterateCapturedProfileDeclarations} from '../../../src/runtime/verification/captured-profile-mapper.js';
let tools:ReturnType<typeof compileTimedCustody>;
beforeAll(()=>{if(posix)tools=compileTimedCustody(root);},40000);
let serial=0;
function path(){const dir=join(root,'capture-'+serial++);mkdirSync(dir);return join(dir,'timed-actions.sqlite');}
function change(file:string,run:(db:Database.Database)=>void){const db=new Database(file);try{run(db);}finally{db.close();}}
async function held(file:string,work:(owner:Awaited<ReturnType<typeof startProfileSourceCapture>>,token:object)=>Promise<void>|void){
 const registered=readOrdinaryProfileSources()!.sources.find(s=>s.directory.canonicalPath===dirname(file)&&s.database?.basename===basename(file))!;
 expect(registered).toBeDefined();const source:ProfileCaptureSource={sourceId:registered.sourceId,kind:'sqlite-db',snapshotFormat:'timed-actions-sqlite-v1',directory:registered.directory,database:registered.database!};
 const owner=await startProfileSourceCapture({uid:process.getuid!(),...tools,sources:[source],signal:new AbortController().signal});try{await work(owner,await owner.capture());}finally{await owner.close();}
}
it.skipIf(!posix).each([undefined,0,1])('captures all six original producer tables, including cold legacy layout %s and raw receipts',async legacy=>{
 const file=path();await populateTimedStore(file,legacy);
 await held(file,async(owner,token)=>{
  const events=[...iterateCapturedSQLiteTimedActionSources(owner,token)],rows=events.filter(e=>e.kind==='row'),end=events.find(e=>e.kind==='source-end')!;
  expect(Object.keys(end.counts)).toHaveLength(6);expect(Object.values(end.counts).every(n=>n>0)).toBe(true);
  change(file,db=>{for(const table of Object.keys(end.counts)){const name=table.slice('timed:'.length),actual=db.prepare('SELECT rowid,* FROM "'+name+'" ORDER BY rowid').safeIntegers().all() as Record<string,unknown>[];expect(rows.filter(r=>r.table===name).map(r=>r.rowid)).toEqual(actual.map(r=>String(r.rowid)));for(const row of rows.filter(r=>r.table===name)){const raw=actual.find(a=>String(a.rowid)===row.rowid)!;for(const [column,cell] of Object.entries(row.record)){if(cell.type==='text')expect(cell.value).toBe(raw[column]);else if(cell.type==='integer')expect(cell.value).toBe(String(raw[column]));else if(cell.type==='null')expect(raw[column]).toBeNull();}}}});
  expect(rows.find(r=>r.table==='loop_timed_completion_receipts')!.record.record_json.type).toBe('text');
  expect(readProfileSqliteSchema(owner,token,events[0]!.sourceId)).toHaveLength(14);
  const mapped=[];for await(const event of iterateCapturedProfileDeclarations(owner,token))mapped.push(event);
  expect(mapped.at(-1)?.kind).toBe('complete');expect(mapped.some(e=>e.kind==='gap'&&e.reason==='unsupported-semantic'&&e.origin.path.endsWith('.record_json'))).toBe(true);expect(mapped.some(e=>e.kind==='relation'&&e.namespace==='timed-action'&&e.resolution==='unique-declaration')).toBe(true);
  expect(mapped.at(-1)).not.toHaveProperty('authority');expect(readOrdinaryProfileSources()!.legacyInventoryRequired).toBe(true);
 });
});
it.skipIf(!posix)('preserves lossless integer, real, blob, null and original JSON text without interpreting permissions',async()=>{
 const file=path();await populateTimedStore(file);const raw=' { "uninterpreted" : [9007199254740993, "😀"] } ';
 change(file,db=>{db.prepare('UPDATE timed_actions SET policy_json=?').run(raw);db.exec("UPDATE automation_store_metadata SET value=9223372036854775807 WHERE key='version'");db.prepare('INSERT INTO automation_store_metadata VALUES(?,?)').run('blob',Buffer.from([0,255]));db.prepare('INSERT INTO automation_store_metadata VALUES(?,?)').run('real',1.25);});
 await held(file,(owner,token)=>{const rows=[...iterateCapturedSQLiteTimedActionSources(owner,token)].filter(e=>e.kind==='row');expect(rows.filter(r=>r.table==='timed_actions').every(r=>r.record.policy_json.value===raw)).toBe(true);const meta=rows.filter(r=>r.table==='automation_store_metadata');expect(meta.map(r=>r.record.value)).toContainEqual({type:'integer',value:'9223372036854775807'});expect(meta.map(r=>r.record.value)).toContainEqual({type:'blob',value:'AP8='});expect(meta.map(r=>r.record.value)).toContainEqual({type:'real',value:'3ff4000000000000'});expect(rows.some(r=>Object.values(r.record).some(c=>c.type==='null'))).toBe(true);});
});
it.skipIf(!posix).each(['table','column','index','trigger','foreign-key'])('rejects unsupported actual timed schema/integrity %s without a complete',async mode=>{
 const file=path();await populateTimedStore(file);
 change(file,db=>{if(mode==='table')db.exec('CREATE TABLE hidden(x)');else if(mode==='column')db.exec('ALTER TABLE timed_actions ADD COLUMN hidden TEXT');else if(mode==='index')db.exec('CREATE INDEX hidden ON timed_actions(title)');else if(mode==='trigger')db.exec('CREATE TRIGGER hidden AFTER UPDATE ON timed_actions BEGIN SELECT 1; END');else{db.pragma('foreign_keys=OFF');db.exec("UPDATE timed_action_runs SET action_id='missing'");}});
 await held(file,(owner,token)=>{const seen:string[]=[];expect(()=>{for(const e of iterateCapturedSQLiteTimedActionSources(owner,token))seen.push(e.kind);}).toThrow();expect(seen).not.toContain('complete');});
});
it.skipIf(!posix)('uses original fixed format/owner gates and closes early iterators before another schema read',async()=>{
 const file=path();await populateTimedStore(file);await held(file,async(owner,token)=>{const first=iterateCapturedSQLiteTimedActionSources(owner,token);expect(first.next().value!.kind).toBe('source-start');first.next();first.return();const sourceId=readOrdinaryProfileSources()!.sources.find(s=>s.database?.basename===basename(file)&&s.directory.canonicalPath===dirname(file))!.sourceId;expect(readProfileSqliteSchema(owner,token,sourceId).length).toBeGreaterThan(0);expect(()=>[...readProfileSqliteLosslessRows(owner,token,sourceId,'state_entities')]).toThrow('query_format');expect(()=>[...iterateCapturedSQLiteTimedActionSources({...owner},token)]).toThrow('brand');await owner.close();expect(()=>[...iterateCapturedSQLiteTimedActionSources(owner,token)]).toThrow();});
});
it.each(['protected','unavailable'])('refuses %s timed birth before filesystem creation',route=>{const file=join(root,'denied-'+route,'timed.sqlite');scope.route=route;try{expect(()=>new TimedActionStore(file)).toThrow('ordinary_source_route');expect(existsSync(dirname(file))).toBe(false);}finally{scope.route='ordinary';}});
it.skipIf(!posix).each([':memory:',''])('does not register the original nonpersistent %j store',file=>{const before=readOrdinaryProfileSources(),store=new TimedActionStore(file);try{expect(store.listActions()).toEqual([]);}finally{store.close();}expect(readOrdinaryProfileSources()).toEqual(before);});

it('keeps Windows ordinary observation absent without expanding POSIX source qualification',()=>{
 const platform=Object.getOwnPropertyDescriptor(process,'platform')!,registry=join(process.env.XIAOK_CONFIG_DIR!,'profile-sources','registry.json'),before=existsSync(registry)?{bytes:readFileSync(registry),mtime:statSync(registry,{bigint:true}).mtimeNs}:undefined,file=path();
 Object.defineProperty(process,'platform',{...platform,value:'win32'});try{for(const value of [file,':memory:','']){const store=new TimedActionStore(value);try{expect(store.listActions()).toEqual([]);}finally{store.close();}}}finally{Object.defineProperty(process,'platform',platform);}
 expect(existsSync(registry)?{bytes:readFileSync(registry),mtime:statSync(registry,{bigint:true}).mtimeNs}:undefined).toEqual(before);
});

it.skipIf(!posix)('detects omission of a timed JSON gap through the original independent input slots',async()=>{
 const file=path();await populateTimedStore(file);const {CapturedProfileRelations}=await import('../../../src/runtime/verification/captured-profile-relations.js'),original=CapturedProfileRelations.prototype.complex;
 await held(file,async(owner,token)=>{const omission=vi.spyOn(CapturedProfileRelations.prototype,'complex').mockImplementation(function(this:InstanceType<typeof CapturedProfileRelations>,value,origin){if(origin.path.endsWith('.record_json'))return;return original.call(this,value,origin);});const events=[];try{await expect((async()=>{for await(const event of iterateCapturedProfileDeclarations(owner,token))events.push(event);})()).rejects.toThrow('unprojected_slot');expect(events.some(e=>e.kind==='complete')).toBe(false);}finally{omission.mockRestore();}});
});
