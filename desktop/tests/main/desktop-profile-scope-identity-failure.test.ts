// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

// Fault injection at the continuity census (profile-probe), the step a fresh
// install's identity runs first. Armed only for the first start.
const probe=vi.hoisted(()=>({fail:false,calls:0}));
vi.mock('../../../src/runtime/context-continuity/profile-probe.js',async importOriginal=>{
 const actual=await importOriginal<typeof import('../../../src/runtime/context-continuity/profile-probe.js')>();
 return {...actual,readProfileDomainCensus:(dataRoot:string)=>{probe.calls++;if(probe.fail)throw Error('profile_identity_unavailable');return actual.readProfileDomainCensus(dataRoot);}};
});
import {createDesktopServices} from '../../electron/desktop-services.js';
import {resolveDesktopMainIdentity,mainDshScopeAvailable,type DesktopMainIdentity} from '../../electron/desktop-main-identity.js';
import {mainActivityOwnerConfig} from '../../electron/activity-owner-main-config.js';
import {writeOwnerLaunchConfig} from '../../electron/activity-owner-writer-launcher.js';
import {startKSwarmWithActivityOwner,createOnceNotice} from '../../electron/activity-owner-startup.js';
import {mockKSwarmService} from '../support/desktop-services-fixtures.js';
import {activityOwnerAddress} from '../../../src/runtime/conversation-activity/owner-protocol.js';
import {readProtectedOwnerQualification} from '../../../src/runtime/conversation-activity/owner-qualification.js';

// #233 review (CTO/质量 17:57 UTC+8): identity failure on a root without
// legacy data must fail closed. The failed start degrades and writes no
// legacy-scoped row; the next two starts are an ordinary fresh install.
type Platform='win32'|'darwin';
const cleanups:Array<()=>Promise<void>|void>=[];
afterEach(async()=>{probe.fail=false;for(const cleanup of cleanups.splice(0).reverse())await cleanup();vi.unstubAllEnvs();});
function onPlatform<T>(platform:Platform,run:()=>T):T{
 const original=Object.getOwnPropertyDescriptor(process,'platform')!;
 if(process.platform===platform)return run();
 Object.defineProperty(process,'platform',{...original,value:platform});
 try{return run();}finally{Object.defineProperty(process,'platform',original);}
}
const legacyOf=(dataRoot:string)=>createHash('sha256').update(resolve(dataRoot)).digest('hex');
/** Every value the continuity census would read, from every census table that exists. */
function scopeValues(dataRoot:string):string[]{
 const tables:Array<[string,Array<[string,string]>]>=[
  ['multi-agent/groups.sqlite',[['thread_bindings','profile_id'],['workspace_execution_authorizations','profile_id']]],
  ['codex-native.sqlite',[['codex_native_sessions','owner']]],
  ['conversation-activity.sqlite',[['work_watches','profile_id'],['conversation_activities','profile_id'],['conversation_reads','profile_id'],['activity_presentations','profile_id'],['thread_tombstones','profile_id']]],
 ];
 const values=new Set<string>();
 for(const [file,columns] of tables){
  const path=join(dataRoot,file);if(!existsSync(path))continue;
  const db=new DatabaseSync(path,{readOnly:true});
  try{const names=new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row=>String(row.name)));
   for(const [table,column] of columns)if(names.has(table))for(const row of db.prepare(`SELECT DISTINCT ${column} AS v FROM ${table}`).all())values.add(String(row.v).replace(/^desktop-user:/,''));
  }finally{db.close();}
 }
 return [...values].sort();
}
/** Every place holding `needle` under `root`: sqlite databases by content (every
 * table, every column, text and blob), every other file (and sqlite sidecars) by bytes. */
function filesContaining(root:string,needles:readonly string[]):string[]{
 const hits:string[]=[];
 const walk=(dir:string)=>{for(const name of readdirSync(dir)){const path=join(dir,name),st=lstatSync(path);
  if(st.isDirectory()){walk(path);continue;}if(!st.isFile())continue;
  const bytes=readFileSync(path);
  for(const needle of needles)if(bytes.includes(Buffer.from(needle))||bytes.includes(Buffer.from(needle.toUpperCase())))hits.push(`${path} (bytes)`);
  if(bytes.subarray(0,16).toString('latin1')==='SQLite format 3\0'){
   const db=new DatabaseSync(path,{readOnly:true});
   try{for(const {name:table} of db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as Array<{name:string}>)
    for(const row of db.prepare(`SELECT * FROM "${table.replaceAll('"','""')}"`).all() as Array<Record<string,unknown>>)
     for(const [column,value] of Object.entries(row)){const text=value instanceof Uint8Array?Buffer.from(value).toString('latin1'):String(value);
      for(const needle of needles)if(text.toLowerCase().includes(needle))hits.push(`${path} ${table}.${column}`);}
   }finally{db.close();}
  }
 }};
 walk(root);return [...new Set(hits)].sort();
}
/** Every sqlite table under `root` holding rows, as "<relative path> <table>=<count>". */
function populatedTables(root:string):string[]{
 const out:string[]=[];
 const walk=(dir:string)=>{for(const name of readdirSync(dir)){const path=join(dir,name),st=lstatSync(path);
  if(st.isDirectory()){walk(path);continue;}if(!st.isFile()||readFileSync(path).subarray(0,16).toString('latin1')!=='SQLite format 3\0')continue;
  const db=new DatabaseSync(path,{readOnly:true});
  try{for(const {name:table} of db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as Array<{name:string}>){
   const {c}=db.prepare(`SELECT count(*) AS c FROM "${table.replaceAll('"','""')}"`).get() as {c:number};if(c>0)out.push(`${path.slice(root.length+1)} ${table}=${c}`);}
  }finally{db.close();}
 }};
 walk(root);return out.sort();
}
/** Regular files under `dir` (relative), recursively; [] when absent. */
function filesUnder(dir:string):string[]{
 if(!existsSync(dir))return [];const out:string[]=[];
 const walk=(d:string)=>{for(const name of readdirSync(d)){const path=join(d,name),st=lstatSync(path);if(st.isDirectory())walk(path);else out.push(path.slice(dir.length+1));}};
 walk(dir);return out.sort();
}
async function mainStart(platform:Platform,base:string,dataRoot:string){
 const logs:string[]=[];
 const identity:DesktopMainIdentity=onPlatform(platform,()=>resolveDesktopMainIdentity(dataRoot));
 if(identity.failure!==undefined)logs.push(`[context-continuity] identity refused, continuity degrades: ${identity.failure}`);
 // Every KSwarm business request Services makes (delegation, room, dispatch traffic).
 const kswarmRequests:string[]=[],kswarmService=mockKSwarmService(),request=kswarmService.request.bind(kswarmService);
 kswarmService.request=async(path,init)=>{kswarmRequests.push(String(path));return request(path,init);};
 const services=createDesktopServices({dataRoot,workspaceRoot:base,knowledgeDbPath:join(base,'knowledge.sqlite'),pluginRootDir:join(base,'plugins'),pluginDependencies:[],
  kswarmService,mainIdentity:identity,continuityLog:line=>logs.push(line),activityOwnerLog:line=>logs.push(line)});
 let closed=false;const close=async()=>{if(closed)return;closed=true;const result=await services.disposeMultiAgent();if(!result.drained)throw Error('fixture_close_unconfirmed');};
 cleanups.push(close);
 await services.multiAgent?.ready;
 return {identity,services,logs,close,kswarmRequests};
}
/** Main's startup attach sequence; the attach is Services' own, qualified like the owner client. */
async function attach(platform:Platform,start:Awaited<ReturnType<typeof mainStart>>,dataRoot:string){
 const release=vi.fn(),notices:string[]=[];
 const result=await startKSwarmWithActivityOwner({activityEnabled:true,log:line=>start.logs.push(line),
  kswarmService:{activityOwnerConfig:async()=>({managedSources:[]}) as never,releaseActivityOwnerDelegation:release,start:async()=>{}},
  attachConversationActivityOwner:async()=>{
   if(start.identity.scope==='unavailable')return start.services.attachConversationActivityOwner({managedSources:[]});
   const profileId=start.services.multiAgent!.profileId,config=mainActivityOwnerConfig(dataRoot,profileId,{}),address=activityOwnerAddress(config.dataRoot);
   writeOwnerLaunchConfig(address.dataRoot,randomBytes(16).toString('hex'),{...config,dataRoot:address.dataRoot});
   const q=onPlatform(platform,()=>readProtectedOwnerQualification(dataRoot));if(q?.profileId!==profileId)throw Error('activity_owner_qualification_unavailable');
  }},createOnceNotice(text=>{notices.push(text);}));
 return {result,release,notices};
}

describe.each(['win32','darwin'] as const)('fresh install whose first identity fails, then start / restart on %s',platform=>{
 it('the failed start writes no legacy-scoped row; the next two starts attach, never hit profile.ts:28 and write no migration file',async()=>{
  const base=mkdtempSync(join(tmpdir(),`profile-scope-idfail-${platform}-`));cleanups.push(()=>rmSync(base,{recursive:true,force:true}));
  vi.stubEnv('XIAOK_CONFIG_DIR',join(base,'config'));vi.stubEnv('XIAOK_DISABLE_GLOBAL_PLUGINS','1');
  const dataRoot=join(base,'data');mkdirSync(dataRoot,{recursive:true,mode:0o700});mkdirSync(join(base,'config'),{recursive:true});
  writeFileSync(join(base,'config','config.json'),JSON.stringify({schemaVersion:1,defaultModel:'custom',models:{custom:{baseUrl:'http://127.0.0.1:1/v1',apiKey:'fixture-only',model:'fixture'}},defaultMode:'interactive',channels:{}}));
  const legacy=legacyOf(dataRoot);

  probe.fail=true;
  const failed=await mainStart(platform,base,dataRoot);
  probe.fail=false;
  // Soft: under a regression every downstream symptom (rows, :28, migration) is reported, not just the first.
  expect.soft(probe.calls).toBeGreaterThan(0);
  expect.soft(failed.identity.scope).toBe('unavailable');
  expect.soft(failed.identity.failure).toMatch(/^profile_identity_unavailable/);
  // The failed round's in-memory scope is neither the legacy digest nor a value a later start can see.
  expect.soft(failed.identity.profileId).toMatch(/^[a-f0-9]{64}$/);expect.soft(failed.identity.profileId).not.toBe(legacy);
  expect.soft(mainDshScopeAvailable(failed.identity),'DSH must not prepare a scoped runtime').toBe(false);
  expect.soft(readFileSync(new URL('../../electron/main.ts',import.meta.url),'utf8'),'Main must gate DSH on the scope').toContain('dshQualification.qualified&&mainDshScopeAvailable(mainIdentity)?createOriginalMainDshServiceSources(');
  expect.soft(failed.services.multiAgent).toBeNull();
  // A user send in the failed round (Main's real submission entry).
  const send=await Promise.resolve().then(()=>failed.services.submitUserTask({action:'submit_new',gestureId:randomUUID(),input:{kind:'materials',prompt:'Say hello.',materials:[],context:{threadId:'idfail-thread'}}} as never,{requestSource:'user',actorId:`desktop-user:${failed.identity.profileId}`} as never)).then(value=>({value}),raw=>({error:raw instanceof Error?raw.message:String(raw)}));
  expect.soft(send,'failed-round send must be refused before any record').toEqual({error:'desktop_profile_scope_unavailable'});
  const degraded=await attach(platform,failed,dataRoot);
  expect.soft(degraded.result).toEqual({attached:false});expect.soft(degraded.release).toHaveBeenCalledTimes(1);
  expect.soft(failed.logs.join('\n')).toContain('desktop_profile_scope_unavailable');
  await failed.close();
  // #233 review (b): nothing under the base (dataRoot, config dir) carries the
  // legacy digest or the failed round's in-memory scope.
  expect.soft(filesContaining(base,[legacy,failed.identity.profileId]),'failed start persisted a scope').toEqual([]);
  expect.soft(scopeValues(dataRoot),'failed start wrote a scope row').toEqual([]);
  expect.soft(existsSync(join(dataRoot,'multi-agent','groups.sqlite'))).toBe(false);
  expect.soft(readdirSync(dataRoot).filter(name=>name.startsWith('activity-owner'))).toEqual([]);
  // #233 质量 (b): the failed round's KSwarm, writer and dispatch leave no
  // delegation, operation or state behind, so a later start can find no orphan.
  // - KSwarm: delegation state lives in the KSwarm service process, not under the
  //   Desktop base (this fixture's mockKSwarmService has no store). Desktop's side
  //   is the owner delegation, released on the refused attach
  //   (activity-owner-startup.ts:41; refusal desktop-services.ts
  //   attachConversationActivityOwner), and any KSwarm business request (none; with
  //   this fixture the later starts make none either, so that check only guards a new one).
  // - Writer: the owner launch/config files (activity-owner-writer-launcher.ts:213
  //   writeOwnerLaunchConfig), asserted absent above; no conversation-activity.sqlite
  //   (association_operations, work_watches, activities) exists.
  // - Dispatch: default-dispatch and user actions are journaled by
  //   MainUserSubmissionOwner under conversation-projects/user-submissions, refused at
  //   main-user-submission.ts:147/:222 (this fixture builds no defaultDispatchBootstrap).
  // The only populated table is the artifact workspace's schema meta row (no scope, no operation).
  expect.soft(populatedTables(base),'failed round left delegation/operation/state rows').toEqual(['data/artifact-workspace/workspace.sqlite artifact_workspace_meta=1']);
  expect.soft(filesUnder(join(dataRoot,'conversation-projects')),'failed round journaled a submission/dispatch').toEqual([]);
  expect.soft(filesUnder(join(dataRoot,'conversation-rooms')),'failed round left room state').toEqual([]);
  expect.soft(existsSync(join(dataRoot,'conversation-activity.sqlite')),'failed round opened the activity store').toBe(false);
  expect.soft(failed.kswarmRequests,'failed round sent KSwarm business requests').toEqual([]);

  let scope:string|undefined;
  for(const n of [2,3]){
   const start=await mainStart(platform,base,dataRoot);
   expect.soft(start.identity.failure,`start ${n}: identity refused`).toBeUndefined();
   expect.soft(start.logs.join('\n'),`start ${n}`).not.toMatch(/profile_identity_unavailable|profile\.ts:28/);
   expect.soft(existsSync(join(dataRoot,'continuity-profile-migration.json')),`start ${n}: migration file`).toBe(false);
   const owner=await attach(platform,start,dataRoot);
   expect.soft(owner.result,`start ${n}: owner attach`).toEqual({attached:true});expect.soft(owner.release).not.toHaveBeenCalled();expect.soft(owner.notices).toEqual([]);
   expect.soft(start.identity.scope).toBe('continuity');expect.soft(start.identity.profileId).not.toBe(legacy);
   scope??=start.identity.profileId;expect.soft(start.identity.profileId).toBe(scope);
   expect.soft(scopeValues(dataRoot),`start ${n}: census values`).toEqual([scope]);
   expect.soft(scopeValues(dataRoot)).not.toContain(legacy);
   expect.soft(start.identity.profileId,`start ${n} read the failed round's scope`).not.toBe(failed.identity.profileId);
   expect.soft(mainDshScopeAvailable(start.identity)).toBe(true);
   // #233 质量 (b): no residue or orphan of the failed round. Exactly this start's
   // own rows: one boot owner per later start (none from the failed round), the
   // fresh grant, continuity's own meta and effect-inventory row; no delegation,
   // operation, watch, submission journal or room state.
   expect.soft(populatedTables(base),`start ${n}: rows`).toEqual([
    'data/artifact-workspace/workspace.sqlite artifact_workspace_meta=1',
    'data/continuity.sqlite continuity_meta=7','data/continuity.sqlite unproven_effects=1',
    `data/multi-agent/groups.sqlite boot_owners=${n-1}`,'data/multi-agent/groups.sqlite workspace_execution_authorizations=1',
   ]);
   expect.soft(filesUnder(join(dataRoot,'conversation-projects')),`start ${n}: submission/dispatch journal`).toEqual([]);
   expect.soft(filesUnder(join(dataRoot,'conversation-rooms')),`start ${n}: room state`).toEqual([]);
   await start.close();
  }
  // Nothing persisted by starts 2 and 3 names the failed round's scope or the legacy digest.
  expect.soft(filesContaining(base,[legacy,failed.identity.profileId]),'later starts persisted a stale scope').toEqual([]);
 },120_000);
});
