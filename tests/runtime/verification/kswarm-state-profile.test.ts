import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
const account=vi.hoisted(()=>({home:''}));
vi.mock('node:os',async load=>({...await load<typeof import('node:os')>(),userInfo:()=>({username:'source-fixture',uid:process.getuid!(),gid:process.getgid!(),shell:null,homedir:account.home})}));
vi.mock('../../../src/runtime/verification/migration-markers.js',async load=>({...await load<typeof import('../../../src/runtime/verification/migration-markers.js')>(),readInstalledCurrentProfile:()=>({kind:'ordinary'})}));
const root=realpathSync(mkdtempSync(join(tmpdir(),'original-ks-profile-'))),config=join(root,'config'),oldConfig=process.env.XIAOK_CONFIG_DIR,originalHome=process.env.HOME;
mkdirSync(config,{mode:0o700});account.home=join(root,'account');mkdirSync(account.home,{mode:0o700});process.env.XIAOK_CONFIG_DIR=config;
type Helper=typeof import('../../support/kswarm-state-source-fixture.js');
let helpers:Helper,compiled:ReturnType<Helper['compileKSwarmSourceCustody']>,read:typeof import('../../../src/runtime/verification/captured-sqlite-kswarm.js').iterateCapturedSQLiteKSwarmStateSources;
beforeAll(async()=>{helpers=await import('../../support/kswarm-state-source-fixture.js');compiled=helpers.compileKSwarmSourceCustody(root);read=(await import('../../../src/runtime/verification/captured-sqlite-kswarm.js')).iterateCapturedSQLiteKSwarmStateSources;},40000);
beforeEach(()=>{process.env.XIAOK_CONFIG_DIR=config;expect(process.env.HOME).toBe(originalHome);});
afterAll(()=>{if(oldConfig===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=oldConfig;expect(process.env.HOME).toBe(originalHome);rmSync(root,{recursive:true,force:true});});
function fixture(mode:string){const directory=mkdtempSync(join(root,'store-')),path=join(directory,'state.sqlite'),produced=helpers.createOriginalKSwarmSource(path,mode);return{path,produced};}
function change(path:string,fn:(db:Database.Database)=>void){const db=new Database(path);try{fn(db);}finally{db.close();}}
it.each(['plain','1','2','3','4','5','6','7','dsh8','transition'])('reads original %s schema and every raw physical row without migrating its floor',async mode=>{
 const {path,produced}=fixture(mode),before=readFileSync(path);
 await helpers.withOriginalKSwarmCapture(path,compiled,(owner,token)=>{
  const events=[...read(owner,token)],rows=events.filter(e=>e.kind==='row');expect(events.at(-1)?.kind).toBe('complete');
  change(path,db=>{for(const table of ['state_entities','state_entity_history','state_meta']){
   const actual=db.prepare('SELECT rowid AS original_rowid,* FROM '+table+' ORDER BY rowid').safeIntegers(true).all() as Array<Record<string,unknown>>;
   expect(rows.filter(e=>e.table===table).map(e=>({rowid:e.rowid,record:e.record}))).toEqual(actual.map(({original_rowid,...record})=>({rowid:String(original_rowid),record:Object.fromEntries(Object.entries(record).map(([key,value])=>[key,value===null?{type:'null'}:typeof value==='bigint'?{type:'integer',value:String(value)}:{type:'text',value}]))})));
  }});
  const expected=mode==='plain'?7:mode==='transition'?25:16;expect(produced.schema).toHaveLength(expected);expect(events.at(-1)).not.toHaveProperty('authority');
 });expect(readFileSync(path)).toEqual(before);
});
it('reads genuine Hub-created immutable protocol receipts, preserving the original full raw JSON',async()=>{
 const {path}=fixture('ordinary-receipts');await helpers.withOriginalKSwarmCapture(path,compiled,(owner,token)=>{
  const events=[...read(owner,token)],receipts=events.filter(e=>e.kind==='row'&&e.record.collection?.type==='text'&&e.record.collection.value==='protocolReceipt');expect(receipts.length).toBeGreaterThan(0);expect(receipts.every(e=>e.kind==='row'&&e.record.state_json?.type==='text')).toBe(true);expect(events.at(-1)?.kind).toBe('complete');
 });
});
it.each(['missing-trigger','changed-trigger','extra-trigger','floor-digest','floor-duplicate-key','floor-scope','transition-missing','transition-hash','transition-revision'])('rejects original %s corruption, preserves bytes and never yields complete',async mode=>{
 const {path}=fixture(mode.startsWith('transition')?'transition':'dsh8');
 change(path,db=>{
  // Register only the existing native trigger guards in this controlled mutation.
  const contracts=mode.startsWith('transition')?['kswarm_writer_profile_v1','kswarm_default_dispatch_transition_writer_v1']:['kswarm_dsh_admission_owner_writer_v1'];
  for(const name of contracts){const sql=(db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND sql LIKE ? LIMIT 1").get('%'+name+'()%') as {sql:string}).sql;const digest=sql.match(/IS NOT '([a-f0-9]{64})'/)![1]!;db.function(name,()=>digest);}
  const triggers=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all() as Array<{name:string;sql:string}>;
  if(mode==='extra-trigger')db.exec('CREATE TRIGGER unexpected AFTER INSERT ON state_entities BEGIN SELECT 1; END');
  else if(mode==='missing-trigger'||mode==='changed-trigger'){const t=triggers[0]!;db.exec('DROP TRIGGER "'+t.name+'"');if(mode==='changed-trigger')db.exec(t.sql.replace('writer_floor_profile_required','different_guard'));}
  else{
   // Remove exact guards solely to corrupt the real frozen source for a negative.
   for(const t of triggers)db.exec('DROP TRIGGER "'+t.name+'"');
   if(mode==='transition-missing')db.prepare("DELETE FROM state_meta WHERE meta_key='writer_transition_v1'").run();
   else if(mode==='transition-revision')db.prepare("UPDATE state_meta SET meta_value='0' WHERE meta_key='revision'").run();
   else{const key=mode.startsWith('transition')?'writer_transition_v1':'writer_floor_v1',old=(db.prepare('SELECT meta_value FROM state_meta WHERE meta_key=?').get(key) as {meta_value:string}).meta_value;let value=old;
    if(mode==='floor-duplicate-key')value=old.replace('{','{"schemaVersion":8,');else{const body=JSON.parse(old);if(mode==='floor-digest')body.writerProfileDigest='0'.repeat(64);else if(mode==='floor-scope')body.scope.profileId='bad';else body.snapshotDigest='0'.repeat(64);value=JSON.stringify(body);}db.prepare('UPDATE state_meta SET meta_value=? WHERE meta_key=?').run(value,key);
   }
   for(const t of triggers)db.exec(t.sql);
  }
 });
 const before=readFileSync(path);await helpers.withOriginalKSwarmCapture(path,compiled,(owner,token)=>{const kinds:string[]=[];expect(()=>{for(const e of read(owner,token))kinds.push(e.kind);}).toThrow();expect(kinds).not.toContain('complete');});expect(readFileSync(path)).toEqual(before);
});
it('projects every original metadata cell as an unsupported semantic gap and independently rejects an omission',async()=>{
 const {path}=fixture('dsh8'),{iterateCapturedProfileDeclarations}=await import('../../../src/runtime/verification/captured-profile-mapper.js'),{CapturedProfileRelations}=await import('../../../src/runtime/verification/captured-profile-relations.js');
 await helpers.withOriginalKSwarmCapture(path,compiled,async(owner,token)=>{
  const all=[];for await(const e of iterateCapturedProfileDeclarations(owner,token))all.push(e);expect(all.at(-1)?.kind).toBe('complete');expect(all.some(e=>e.kind==='gap'&&e.origin.path==='state_meta[1].meta_key')).toBe(true);
  const original=CapturedProfileRelations.prototype.complex,spy=vi.spyOn(CapturedProfileRelations.prototype,'complex').mockImplementation(function(this:InstanceType<typeof CapturedProfileRelations>,value,origin){if(origin.path==='state_meta[1].meta_value')return;return original.call(this,value,origin);});
  try{await expect((async()=>{for await(const _e of iterateCapturedProfileDeclarations(owner,token)){/* actual complete must be unreachable */}})()).rejects.toThrow('unprojected_slot');}finally{spy.mockRestore();}
 });
});
