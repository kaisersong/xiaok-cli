// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {resolveDesktopProfile,loadContinuityProfile} from '../../../src/runtime/context-continuity/profile.js';
import {mainActivityOwnerConfig} from '../../electron/activity-owner-main-config.js';
import {writeOwnerLaunchConfig} from '../../electron/activity-owner-writer-launcher.js';
import {activityOwnerAddress} from '../../../src/runtime/conversation-activity/owner-protocol.js';
import {readProtectedOwnerQualification} from '../../../src/runtime/conversation-activity/owner-qualification.js';
import {desktopActivityProfileId,desktopContinuityScopeProfileId} from '../../../src/runtime/conversation-activity/owner-profile-id.js';

// #233 UUID scope: the two places that now accept Main's scope must not accept
// anything wider. A scope digest is only this root's own; the legacy-only
// qualification exception needs a root with no continuity artifact at all.
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function tempRoot(prefix:string){const root=mkdtempSync(join(tmpdir(),prefix));roots.push(root);return root;}
function groupsWith(root:string,profileId:string){
 mkdirSync(join(root,'multi-agent'),{recursive:true,mode:0o700});
 const db=new DatabaseSync(join(root,'multi-agent','groups.sqlite'));
 try{db.exec('PRAGMA user_version=4;CREATE TABLE workspace_execution_authorizations(profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL);CREATE TABLE thread_bindings(thread_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL);');
  db.prepare('INSERT INTO workspace_execution_authorizations VALUES(?,?)').run(profileId,'w'.repeat(64));}finally{db.close();}
}
function onPlatform<T>(platform:'win32'|'darwin',run:()=>T):T{
 const original=Object.getOwnPropertyDescriptor(process,'platform')!;
 if(process.platform===platform)return run();
 Object.defineProperty(process,'platform',{...original,value:platform});
 try{return run();}finally{Object.defineProperty(process,'platform',original);}
}
function launch(root:string,profileId:string){
 const config=mainActivityOwnerConfig(root,profileId,{}),address=activityOwnerAddress(config.dataRoot);
 writeOwnerLaunchConfig(address.dataRoot,randomBytes(16).toString('hex'),{...config,dataRoot:address.dataRoot});
}

it('the continuity census admits the profile\'s own scope digest',()=>{
 const root=tempRoot('scope-guard-own-'),uuid=loadContinuityProfile(root);
 groupsWith(root,desktopContinuityScopeProfileId(uuid));
 expect(resolveDesktopProfile(root)).toEqual({profileId:uuid});
});
it('the continuity census still refuses another profile\'s scope digest',()=>{
 const root=tempRoot('scope-guard-foreign-');loadContinuityProfile(root);
 groupsWith(root,desktopContinuityScopeProfileId(randomUUID()));
 expect(()=>resolveDesktopProfile(root)).toThrow('profile_identity_unavailable');
});
it('qualification accepts the scope digest only of the root\'s own continuity profile',()=>{
 const root=tempRoot('scope-guard-q-'),uuid=loadContinuityProfile(root);
 launch(root,desktopContinuityScopeProfileId(uuid));
 expect(readProtectedOwnerQualification(root)).toMatchObject({profileId:desktopContinuityScopeProfileId(uuid)});
 launch(root,desktopContinuityScopeProfileId(randomUUID()));
 expect(()=>readProtectedOwnerQualification(root)).toThrow('activity_owner_qualification_unavailable');
});
it('legacy-only exception (win32): a legacy root without any continuity artifact qualifies only its own legacy digest',()=>{
 const root=tempRoot('scope-guard-legacy-');groupsWith(root,desktopActivityProfileId(root));
 launch(root,desktopActivityProfileId(root));
 expect(onPlatform('win32',()=>readProtectedOwnerQualification(root))).toMatchObject({profileId:desktopActivityProfileId(root)});
 launch(root,desktopContinuityScopeProfileId(randomUUID()));
 expect(()=>onPlatform('win32',()=>readProtectedOwnerQualification(root))).toThrow('activity_owner_qualification_unavailable');
});
it('legacy-only exception is Windows only: darwin still requires the continuity profile',()=>{
 const root=tempRoot('scope-guard-legacy-darwin-');groupsWith(root,desktopActivityProfileId(root));
 launch(root,desktopActivityProfileId(root));
 expect(()=>onPlatform('darwin',()=>readProtectedOwnerQualification(root))).toThrow('activity_owner_qualification_unavailable');
});
for(const artifact of ['continuity.sqlite','continuity-profile-migration.json','continuity-profile.json']){
 it(`legacy-only exception (win32) does not apply once ${artifact} exists but no readable continuity profile`,()=>{
  const root=tempRoot('scope-guard-artifact-');groupsWith(root,desktopActivityProfileId(root));
  launch(root,desktopActivityProfileId(root));
  writeFileSync(join(root,artifact),'{}',{mode:0o600});
  expect(()=>onPlatform('win32',()=>readProtectedOwnerQualification(root))).toThrow('activity_owner_qualification_unavailable');
 });
}
it('legacy-only exception (win32) rejects another root\'s legacy digest, as profileId alone or with that root as profileRoot',()=>{
 const root=tempRoot('scope-guard-legacy-own-'),other=tempRoot('scope-guard-legacy-other-');
 groupsWith(root,desktopActivityProfileId(root));groupsWith(other,desktopActivityProfileId(other));
 launch(root,desktopActivityProfileId(other));
 expect(()=>onPlatform('win32',()=>readProtectedOwnerQualification(root))).toThrow('activity_owner_qualification_unavailable');
 // A config whose own profileRoot/profileId pair is self-consistent but names the other root.
 const config=mainActivityOwnerConfig(other,desktopActivityProfileId(other),{}),address=activityOwnerAddress(root);
 writeOwnerLaunchConfig(address.dataRoot,randomBytes(16).toString('hex'),{...config,profileRoot:other,dataRoot:address.dataRoot});
 expect(()=>onPlatform('win32',()=>readProtectedOwnerQualification(root))).toThrow('activity_owner_qualification_unavailable');
});
