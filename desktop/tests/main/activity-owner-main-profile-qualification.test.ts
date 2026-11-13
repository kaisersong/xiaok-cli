// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {DesktopContextContinuity} from '../../electron/context-continuity/runtime.js';
import {resolveDesktopServiceScope} from '../../electron/desktop-service-scope.js';
import {mainActivityOwnerConfig} from '../../electron/activity-owner-main-config.js';
import {writeOwnerLaunchConfig} from '../../electron/activity-owner-writer-launcher.js';
import {activityOwnerConfigDigest} from '../../../src/runtime/conversation-activity/owner-runtime.js';
import {activityOwnerAddress} from '../../../src/runtime/conversation-activity/owner-protocol.js';
import {readProtectedOwnerQualification} from '../../../src/runtime/conversation-activity/owner-qualification.js';
import {ensureConversationActivityOwner} from '../../../src/runtime/conversation-activity/owner-launcher.js';

// 1.6.3 RC blocker (#233, CTO 14:12): qualification required the
// continuity-profile.json UUID while Main writes resolveDesktopServiceScope's
// profileId, so no Desktop owner was ever attachable. These cases build the
// config only through Main's own path: resolveDesktopServiceScope ->
// mainActivityOwnerConfig -> the launcher's realpath normalization -> writer.
const cleanups:Array<()=>Promise<void>|void>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
function tempDir(prefix:string){const dir=mkdtempSync(join(tmpdir(),prefix));cleanups.push(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
async function openProfile(root:string){const runtime=new DesktopContextContinuity(root);runtime.port();cleanups.push(()=>runtime.close());return runtime;}
// What desktop-services does for a Main start on `dataRoot`.
function mainLaunch(dataRoot:string,nonce='m'.repeat(32)){
 const scope=resolveDesktopServiceScope({dataRoot});
 const config=mainActivityOwnerConfig(dataRoot,scope.profileId,{});
 const address=activityOwnerAddress(config.dataRoot);
 writeOwnerLaunchConfig(address.dataRoot,nonce,{...config,dataRoot:address.dataRoot});
 return {scope,config:{...config,dataRoot:address.dataRoot},address};
}
it('Main-written config on a blank protected root qualifies with Main\'s service-scope profileId',async()=>{
 const root=tempDir('owner-main-profile-');await openProfile(root);
 const {scope,config,address}=mainLaunch(root);
 const q=readProtectedOwnerQualification(address.dataRoot);
 expect(q).toMatchObject({profileId:scope.profileId,configDigest:activityOwnerConfigDigest(config)});
});
it('a dataRoot under a symlinked parent (macOS /var -> /private/var) still qualifies with Main\'s profileId',async()=>{
 const real=tempDir('owner-main-real-'),parent=tempDir('owner-main-link-'),link=join(parent,'var');
 symlinkSync(real,link,process.platform==='win32'?'junction':'dir');
 mkdirSync(join(real,'xiaok-desktop'));const dataRoot=join(link,'xiaok-desktop');
 await openProfile(dataRoot);
 const {scope,address}=mainLaunch(dataRoot);
 expect(address.dataRoot).toBe(realpathSync(join(real,'xiaok-desktop')));
 expect(address.dataRoot).not.toBe(dataRoot);
 // Main hashes the path it was given; the launcher stores the realpath.
 expect(readProtectedOwnerQualification(dataRoot)).toMatchObject({profileId:scope.profileId});
 expect(readProtectedOwnerQualification(address.dataRoot)).toMatchObject({profileId:scope.profileId});
});
it('a 1.6.2 data directory (old continuity profile, groups.sqlite, stale owner config) qualifies after the new launch',async()=>{
 const root=tempDir('owner-main-upgrade-');await openProfile(root);
 mkdirSync(join(root,'multi-agent'),{recursive:true});writeFileSync(join(root,'multi-agent','groups.sqlite'),'');
 // 1.6.2 left a config bound to the continuity UUID: it must not qualify.
 const address=activityOwnerAddress(root);
 writeFileSync(join(address.dataRoot,'activity-owner.config.json'),JSON.stringify({schemaVersion:1,dataRoot:address.dataRoot,profileId:'2f9c0e0a-0000-4000-8000-000000000000',actorId:'desktop-user:2f9c0e0a-0000-4000-8000-000000000000',identity:{kind:'desktop',path:join(address.dataRoot,'multi-agent','groups.sqlite')}}),{mode:0o600});
 expect(()=>readProtectedOwnerQualification(root)).toThrow('activity_owner_qualification_unavailable');
 const {scope}=mainLaunch(root);
 expect(readProtectedOwnerQualification(root)).toMatchObject({profileId:scope.profileId});
});
function rewrite(root:string,patch:Record<string,unknown>){
 const address=activityOwnerAddress(root),file=join(address.dataRoot,'activity-owner.config.json');
 writeFileSync(file,JSON.stringify({...JSON.parse(readFileSync(file,'utf8')),...patch}),{mode:0o600});
}
it('rejects a Main-shaped config whose profileId is not the one computed from its root',async()=>{
 const root=tempDir('owner-main-wrong-id-'),other=tempDir('owner-main-other-');await openProfile(root);mainLaunch(root);
 const foreign=resolveDesktopServiceScope({dataRoot:other}).profileId;
 rewrite(root,{profileId:foreign,actorId:`desktop-user:${foreign}`});
 expect(()=>readProtectedOwnerQualification(root)).toThrow('activity_owner_qualification_unavailable');
});
it('rejects a config whose actorId is not desktop-user:<profileId>',async()=>{
 const root=tempDir('owner-main-wrong-actor-');await openProfile(root);const {scope}=mainLaunch(root);
 expect(readProtectedOwnerQualification(root)).toMatchObject({profileId:scope.profileId});
 rewrite(root,{actorId:'desktop-user:someone-else'});
 expect(()=>readProtectedOwnerQualification(root)).toThrow('activity_owner_qualification_unavailable');
});
it('rejects a config whose profile root does not resolve to the qualified root',async()=>{
 const root=tempDir('owner-main-wrong-root-'),other=tempDir('owner-main-other-root-');await openProfile(root);mainLaunch(root);
 // Self-consistent id for the other root: only the realpath check can refuse it.
 const id=resolveDesktopServiceScope({dataRoot:other}).profileId;
 rewrite(root,{profileRoot:other,profileId:id,actorId:`desktop-user:${id}`});
 expect(()=>readProtectedOwnerQualification(root)).toThrow('activity_owner_qualification_unavailable');
});
it('a CLI-written owner config (real CLI launcher write) stays outside Desktop qualification',async()=>{
 const root=tempDir('owner-cli-profile-');
 const spawn=vi.fn(()=>{throw Error('fixture_no_spawn');});
 await expect(ensureConversationActivityOwner({schemaVersion:1,dataRoot:root,profileId:'cli:0123456789abcdef01234567',actorId:'cli-user',identity:{kind:'cli',path:join(root,'identity.json'),workspaceRoot:root}},{spawn:spawn as never,timeoutMs:200})).rejects.toThrow('fixture_no_spawn');
 expect(spawn).toHaveBeenCalledOnce();
 expect(readProtectedOwnerQualification(root)).toBeUndefined();
});
