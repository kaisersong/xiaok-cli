// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createDesktopServices} from '../../electron/desktop-services.js';
import {resolveDesktopMainIdentity,type DesktopMainIdentity} from '../../electron/desktop-main-identity.js';
import {mainActivityOwnerConfig} from '../../electron/activity-owner-main-config.js';
import {writeOwnerLaunchConfig} from '../../electron/activity-owner-writer-launcher.js';
import {startKSwarmWithActivityOwner,createOnceNotice} from '../../electron/activity-owner-startup.js';
import {mockKSwarmService} from '../support/desktop-services-fixtures.js';
import {activityOwnerAddress} from '../../../src/runtime/conversation-activity/owner-protocol.js';
import {readProtectedOwnerQualification} from '../../../src/runtime/conversation-activity/owner-qualification.js';
import {desktopActivityProfileId,desktopContinuityScopeProfileId} from '../../../src/runtime/conversation-activity/owner-profile-id.js';

// 1.6.3 RC blocker (#233, ilucas/yzjw census 17:29/17:30 UTC+8): a fresh
// install's first start scoped groups.sqlite by sha256(dataRoot); the second
// start's continuity census then saw that legacy domain: Windows refused
// (profile_identity_unavailable), macOS wrote a false migration file.
// Each start below is Main's production order: resolveDesktopMainIdentity
// (main.ts) -> createDesktopServices({mainIdentity}) -> Main's owner config ->
// the owner-side qualification the attaching client performs. The platform
// under test is injected only around the identity steps (Main and the owner),
// the way the repo's other platform tests do; Services runs on the host.
type Platform='win32'|'darwin';
const PLATFORMS:Platform[]=['win32','darwin'];
const cleanups:Array<()=>Promise<void>|void>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();vi.unstubAllEnvs();});
function onPlatform<T>(platform:Platform,run:()=>T):T{
 const original=Object.getOwnPropertyDescriptor(process,'platform')!;
 if(process.platform===platform)return run();
 Object.defineProperty(process,'platform',{...original,value:platform});
 try{return run();}finally{Object.defineProperty(process,'platform',original);}
}
function fixture(prefix:string){
 const base=mkdtempSync(join(tmpdir(),prefix));cleanups.push(()=>rmSync(base,{recursive:true,force:true}));
 vi.stubEnv('XIAOK_CONFIG_DIR',join(base,'config'));vi.stubEnv('XIAOK_DISABLE_GLOBAL_PLUGINS','1');
 return {base,dataRoot:join(base,'data')};
}
interface Start{identity:DesktopMainIdentity;services:ReturnType<typeof createDesktopServices>;logs:string[]}
async function mainStart(platform:Platform,base:string,dataRoot:string,identity?:DesktopMainIdentity):Promise<Start>{
 const logs:string[]=[];
 const resolved=identity??onPlatform(platform,()=>resolveDesktopMainIdentity(dataRoot));
 if(resolved.failure!==undefined)logs.push(`[context-continuity] identity refused, continuity degrades: ${resolved.failure}`);
 const services=createDesktopServices({dataRoot,workspaceRoot:base,knowledgeDbPath:join(base,'knowledge.sqlite'),pluginRootDir:join(base,'plugins'),pluginDependencies:[],
  kswarmService:mockKSwarmService(),mainIdentity:resolved,continuityLog:line=>logs.push(line),activityOwnerLog:line=>logs.push(line)});
 let closed=false;const close=async()=>{if(closed)return;closed=true;const result=await services.disposeMultiAgent();if(!result.drained)throw Error('fixture_close_unconfirmed');};
 cleanups.push(close);
 await services.multiAgent!.ready;
 return {identity:resolved,services,logs,close} as Start&{close:()=>Promise<void>};
}
async function stop(start:Start){await (start as Start&{close:()=>Promise<void>}).close();}
/** Main's owner config, written by the real launcher path, then the attach the
 * startup sequence performs; the attach qualifies exactly like the owner client. */
async function attachOwner(platform:Platform,start:Start,dataRoot:string){
 const profileId=start.services.multiAgent!.profileId;
 const config=mainActivityOwnerConfig(dataRoot,profileId,{});
 const address=activityOwnerAddress(config.dataRoot);
 writeOwnerLaunchConfig(address.dataRoot,randomBytes(16).toString('hex'),{...config,dataRoot:address.dataRoot});
 const notices:string[]=[],release=vi.fn(),kswarmStart=vi.fn(async()=>{});
 const result=await startKSwarmWithActivityOwner({activityEnabled:true,log:line=>start.logs.push(line),
  kswarmService:{activityOwnerConfig:async()=>({managedSources:[]}) as never,releaseActivityOwnerDelegation:release,start:kswarmStart},
  attachConversationActivityOwner:async()=>{const q=onPlatform(platform,()=>readProtectedOwnerQualification(dataRoot));if(q?.profileId!==profileId)throw Error('activity_owner_qualification_unavailable');}},
  createOnceNotice(text=>{notices.push(text);}));
 return {result,notices,release,kswarmStart};
}
function groupsRows(dataRoot:string){
 const db=new DatabaseSync(join(dataRoot,'multi-agent','groups.sqlite'),{readOnly:true});
 try{return {
  authorizations:db.prepare('SELECT profile_id,workspace_id,permission_revision,execution_allowed,updated_at FROM workspace_execution_authorizations ORDER BY profile_id').all().map(row=>({...row})),
  threads:db.prepare('SELECT thread_id,profile_id,workspace_id,cwd FROM thread_bindings ORDER BY thread_id').all().map(row=>({...row})),
 };}finally{db.close();}
}
const migrationFile=(dataRoot:string)=>join(dataRoot,'continuity-profile-migration.json');

describe.each(PLATFORMS)('fresh install, start / restart / restart on %s',platform=>{
 it('attaches every start, writes no migration file and never reports profile_identity_unavailable',async()=>{
  const {base,dataRoot}=fixture(`profile-scope-fresh-${platform}-`);
  const seen:Array<{identity:DesktopMainIdentity;servicesProfileId:string;rows:unknown[]}>=[];
  // #233 review: computed here, independently of owner-profile-id.ts.
  const rootSha=createHash('sha256').update(resolve(dataRoot)).digest('hex');
  for(const n of [1,2,3]){
   const start=await mainStart(platform,base,dataRoot);
   const {identity}=start;
   // Behaviour first (what the 1.6.3 RC hit), then how the scope is formed.
   expect(identity.failure,`start ${n}: continuity identity refused`).toBeUndefined();
   expect(existsSync(migrationFile(dataRoot)),`start ${n}: fresh install treated as a 1.6.2 migration`).toBe(false);
   expect(identity.continuity).not.toBeNull();
   expect(()=>start.services.continuity.port()).not.toThrow();
   const owner=await attachOwner(platform,start,dataRoot);
   expect(owner.result,`start ${n}: owner attach`).toEqual({attached:true});
   expect(owner.release).not.toHaveBeenCalled();expect(owner.notices).toEqual([]);expect(owner.kswarmStart).toHaveBeenCalledTimes(1);
   expect(start.logs.join('\n')).not.toMatch(/profile_identity_unavailable|continuity_unavailable|kswarm_business_retirement_failed/);
   expect(identity.profileId,`start ${n}: fresh install scoped by sha256(resolve(dataRoot))`).not.toBe(rootSha);
   expect(start.services.multiAgent!.profileId,`start ${n}: Services scoped by sha256(resolve(dataRoot))`).not.toBe(rootSha);
   expect(groupsRows(dataRoot).authorizations.map(row=>row.profile_id),`start ${n}: row scoped by sha256(resolve(dataRoot))`).not.toContain(rootSha);
   seen.push({identity,servicesProfileId:start.services.multiAgent!.profileId,rows:groupsRows(dataRoot).authorizations.map(row=>row.profile_id)});
   await stop(start);
  }
  // How the scope is formed: the continuity-UUID digest, one value for Main,
  // Services and the stored row, stable across all three starts.
  for(const [i,{identity,servicesProfileId,rows}] of seen.entries()){
   expect(identity.scope,`start ${i+1}`).toBe('continuity');
   expect(identity.profileId).toBe(desktopContinuityScopeProfileId(identity.continuity!.profileId));
   expect(identity.profileId).not.toBe(desktopActivityProfileId(dataRoot));
   expect(identity.profileId,`start ${i+1}: Main scope changed between starts`).toBe(seen[0].identity.profileId);
   expect(servicesProfileId).toBe(identity.profileId);
   expect(rows).toEqual([identity.profileId]);
  }
 },120_000);
});

/** 1.6.2 Main (c1775bd6): no continuity profile, sha256(dataRoot) scope, and it
 * wrote the workspace authorization and thread binding with that scope. */
async function seed162(base:string,dataRoot:string){
 const legacy=desktopActivityProfileId(dataRoot);
 const start=await mainStart('darwin',base,dataRoot,Object.freeze({profileId:legacy,continuity:null,scope:'legacy' as const}));
 const {profileId,workspaceId,cwd,service}=start.services.multiAgent!;
 expect(profileId).toBe(legacy);
 await service.registerThreadWithOwnership({threadId:'thread-162',profileId,workspaceId,cwd},'user');
 // The 1.6.2 user revoked and then re-granted workspace execution: revision 2.
 // A Main that lost this row would start a fresh revision-0 grant instead.
 const access=service.createWorkspaceUserAccess({requestSource:'user',actorId:`desktop-user:${profileId}`,profileId,workspaceId});
 for(const [revision,executionAllowed] of [[0,false],[1,true]] as const){
  const {bootId}=service.getExecutionAuthorization();
  await service.setExecutionAuthorization({access,requestSource:'user',operationId:`exec-auth:${bootId}:${revision}:seed${revision}`,expectedPermissionRevision:revision,executionAllowed,confirm:true});
 }
 expect(service.getExecutionAuthorization()).toMatchObject({permissionRevision:2,executionAllowed:true});
 await stop(start);
 for(const name of ['continuity-profile.json','continuity-profile-migration.json'])expect(existsSync(join(dataRoot,name))).toBe(false);
 return {legacy,rows:groupsRows(dataRoot)};
}
async function assertLegacyDataUsable(start:Start,legacy:string,n:number){
 const multi=start.services.multiAgent!;
 expect(multi.profileId,`start ${n}: Main must query the 1.6.2 rows by their scope`).toBe(legacy);
 // Main's own authorization read: the 1.6.2 grant, not a fresh re-authorization.
 expect(multi.service.getExecutionAuthorization()).toMatchObject({permissionRevision:2,executionAllowed:true});
 // Main's user read path for the old session.
 const access=multi.service.createUserAccess({requestSource:'user',actorId:`desktop-user:${multi.profileId}`,threadId:'thread-162',profileId:multi.profileId,workspaceId:multi.workspaceId});
 expect(multi.service.getSnapshot({access})).toMatchObject({threadId:'thread-162',threadDeleteState:'none'});
 // The checks a send passes before preparing: binding, scope and authorization.
 expect(multi.service.assertExecutionAdmission('thread-162')).toBe(2);
}

async function readableAfterRefusal(start:Start,legacy:string,rows:unknown,dataRoot:string,n:number){
 const multi=start.services.multiAgent!;
 expect(multi.profileId).toBe(legacy);
 const access=multi.service.createUserAccess({requestSource:'user',actorId:`desktop-user:${multi.profileId}`,threadId:'thread-162',profileId:multi.profileId,workspaceId:multi.workspaceId});
 expect(multi.service.getSnapshot({access}),`start ${n}: session readable`).toMatchObject({threadId:'thread-162',threadDeleteState:'delete_pending'});
 expect(multi.service.readThreadDeletion({access}),`start ${n}: the refusal is readable`).toMatchObject({deleteState:'delete_pending',operation:{state:'unknown',error:'Error: continuity_unavailable'}});
 expect(groupsRows(dataRoot),`start ${n}: nothing deleted`).toEqual(rows);
 expect(multi.service.getExecutionAuthorization()).toMatchObject({permissionRevision:2,executionAllowed:true});
 expect(()=>multi.service.assertExecutionAdmission('thread-162'),`start ${n}: known 1.6.3 limitation`).toThrow('multi_agent_thread_deletion_pending');
}
/** Main's user deletion of the 1.6.2 session; a refusal is returned, not thrown. */
async function attemptDeletion(start:Start):Promise<unknown>{
 const multi=start.services.multiAgent!;
 const access=multi.service.createUserAccess({requestSource:'user',actorId:`desktop-user:${multi.profileId}`,threadId:'thread-162',profileId:multi.profileId,workspaceId:multi.workspaceId});
 const {threadRevision}=multi.service.readThreadDeletion({access});
 try{return await multi.service.deleteThread({access,requestSource:'user',operationId:`delete:${threadRevision}:degraded`,expectedThreadRevision:threadRevision,confirmTerminate:true});}
 catch(raw){return {thrown:raw instanceof Error?raw.message:String(raw)};}
}
describe('1.6.2 data upgraded, start / restart / restart',()=>{
 it('win32 degraded: a refused deletion returns at once with continuity_unavailable, the session stays readable and survives restart',async()=>{
  // #233 PM (c), CTO: no deletion code change in 1.6.3. Characterizes what the
  // user gets. Known limitation, asserted so a 1.6.4 fix updates it on purpose:
  // the refused thread stays delete_pending, and Main refuses to start new
  // execution on it (multi_agent_thread_deletion_pending), before and after restart.
  const {base,dataRoot}=fixture('profile-scope-162-win32-delete-');
  const {legacy,rows}=await seed162(base,dataRoot);
  const first=await mainStart('win32',base,dataRoot);
  const started=performance.now(),refused=await attemptDeletion(first),elapsed=performance.now()-started;
  expect(refused).toEqual({operationId:'delete:0:degraded',state:'unknown',error:'Error: continuity_unavailable'});
  expect(elapsed,'refused deletion must not hang').toBeLessThan(5000);
  await readableAfterRefusal(first,legacy,rows,dataRoot,1);
  await stop(first);
  const restarted=await mainStart('win32',base,dataRoot);
  expect(restarted.identity.failure).toMatch(/^profile_identity_unavailable \(cause: /);
  await readableAfterRefusal(restarted,legacy,rows,dataRoot,2);
  const owner=await attachOwner('win32',restarted,dataRoot);
  expect(owner.result,'restart after a refused deletion: owner attach').toEqual({attached:true});expect(owner.release).not.toHaveBeenCalled();
  expect(restarted.logs.join('\n')).not.toMatch(/kswarm_business_retirement_failed|Activity owner attach failed/);
  await stop(restarted);
 },120_000);
 it('darwin: migrates once, keeps the 1.6.2 scope, authorization and session usable, owner attaches',async()=>{
  const {base,dataRoot}=fixture('profile-scope-162-darwin-');
  const {legacy,rows}=await seed162(base,dataRoot);
  let uuid:string|undefined;
  for(const n of [1,2,3]){
   const start=await mainStart('darwin',base,dataRoot);
   expect(start.identity.failure,`start ${n}`).toBeUndefined();
   expect(start.identity.continuity).toMatchObject({legacyProfileId:legacy});
   uuid??=start.identity.continuity!.profileId;expect(start.identity.continuity!.profileId).toBe(uuid);
   expect(existsSync(migrationFile(dataRoot)),`start ${n}: migration recorded`).toBe(true);
   expect(()=>start.services.continuity.port()).not.toThrow();
   await assertLegacyDataUsable(start,legacy,n);
   expect(groupsRows(dataRoot),`start ${n}: 1.6.2 rows unchanged`).toEqual(rows);
   const owner=await attachOwner('darwin',start,dataRoot);
   expect(owner.result).toEqual({attached:true});expect(owner.release).not.toHaveBeenCalled();expect(owner.notices).toEqual([]);
   await stop(start);
  }
 },120_000);
 it('win32: refuses adoption, continuity degrades with the inner reason logged; 1.6.2 rows, session and owner stay usable',async()=>{
  const {base,dataRoot}=fixture('profile-scope-162-win32-');
  const {legacy,rows}=await seed162(base,dataRoot);
  for(const n of [1,2,3]){
   const start=await mainStart('win32',base,dataRoot);
   expect(start.identity.continuity).toBeNull();
   expect(start.identity.failure).toMatch(/^profile_identity_unavailable \(cause: /);
   const log=start.logs.join('\n');
   expect(log).toContain(`[context-continuity] identity refused, continuity degrades: ${start.identity.failure}`);
   expect(log).toContain(`[context-continuity] unavailable at identity: ${start.identity.failure}`);
   expect(()=>start.services.continuity.port()).toThrow('continuity_unavailable');
   // #233 review: the skipped effect inventory is visible in main-debug.log (continuityLog = debugMain).
   expect(log).toContain('[context-continuity] effect inventory deferred: continuity degraded (identity refused)');
   for(const name of ['continuity-profile.json','continuity-profile-migration.json'])expect(existsSync(join(dataRoot,name)),`start ${n}: ${name}`).toBe(false);
   await assertLegacyDataUsable(start,legacy,n);
   // #233 review: degraded continuity still blocks conversation deletion.
   expect(()=>start.services.continuity.assertConversationDeletionSafe('thread-162')).toThrow('continuity_unavailable');
   expect(groupsRows(dataRoot),`start ${n}: 1.6.2 rows kept as-is`).toEqual(rows);
   const owner=await attachOwner('win32',start,dataRoot);
   expect(owner.result,`start ${n}: owner attach must not fail with continuity degraded`).toEqual({attached:true});
   expect(owner.release).not.toHaveBeenCalled();expect(owner.notices).toEqual([]);expect(owner.kswarmStart).toHaveBeenCalledTimes(1);
   expect(start.logs.join('\n')).not.toMatch(/kswarm_business_retirement_failed|Activity owner attach failed/);
   if(n===3){
    // Last, because a refused deletion leaves the thread delete_pending: Main's
    // real deletion path is refused at its commit guard and deletes nothing.
    expect(await attemptDeletion(start)).toEqual({operationId:'delete:0:degraded',state:'unknown',error:'Error: continuity_unavailable'});
    expect(groupsRows(dataRoot),'refused deletion removed 1.6.2 rows').toEqual(rows);
   }
   await stop(start);
  }
 },120_000);
});
