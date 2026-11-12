// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';
import {existsSync,mkdirSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
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
import {resolveDesktopMainIdentity,type DesktopMainIdentity} from '../../electron/desktop-main-identity.js';
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
async function mainStart(platform:Platform,base:string,dataRoot:string){
 const logs:string[]=[];
 const identity:DesktopMainIdentity=onPlatform(platform,()=>resolveDesktopMainIdentity(dataRoot));
 if(identity.failure!==undefined)logs.push(`[context-continuity] identity refused, continuity degrades: ${identity.failure}`);
 const services=createDesktopServices({dataRoot,workspaceRoot:base,knowledgeDbPath:join(base,'knowledge.sqlite'),pluginRootDir:join(base,'plugins'),pluginDependencies:[],
  kswarmService:mockKSwarmService(),mainIdentity:identity,continuityLog:line=>logs.push(line),activityOwnerLog:line=>logs.push(line)});
 let closed=false;const close=async()=>{if(closed)return;closed=true;const result=await services.disposeMultiAgent();if(!result.drained)throw Error('fixture_close_unconfirmed');};
 cleanups.push(close);
 await services.multiAgent?.ready;
 return {identity,services,logs,close};
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
  const dataRoot=join(base,'data');mkdirSync(dataRoot,{recursive:true,mode:0o700});
  const legacy=legacyOf(dataRoot);

  probe.fail=true;
  const failed=await mainStart(platform,base,dataRoot);
  probe.fail=false;
  // Soft: under a regression every downstream symptom (rows, :28, migration) is reported, not just the first.
  expect.soft(probe.calls).toBeGreaterThan(0);
  expect.soft(failed.identity.scope).toBe('unavailable');
  expect.soft(failed.identity.failure).toMatch(/^profile_identity_unavailable/);
  expect.soft(failed.services.multiAgent).toBeNull();
  const degraded=await attach(platform,failed,dataRoot);
  expect.soft(degraded.result).toEqual({attached:false});expect.soft(degraded.release).toHaveBeenCalledTimes(1);
  expect.soft(failed.logs.join('\n')).toContain('desktop_profile_scope_unavailable');
  await failed.close();
  expect.soft(scopeValues(dataRoot),'failed start wrote a scope row').toEqual([]);
  expect.soft(existsSync(join(dataRoot,'multi-agent','groups.sqlite'))).toBe(false);
  expect.soft(readdirSync(dataRoot).filter(name=>name.startsWith('activity-owner'))).toEqual([]);

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
   await start.close();
  }
 },120_000);
});
