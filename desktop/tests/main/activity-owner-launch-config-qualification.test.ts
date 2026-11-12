// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {existsSync,mkdtempSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {DesktopContextContinuity} from '../../electron/context-continuity/runtime.js';
import {writeOwnerLaunchConfig} from '../../electron/activity-owner-writer-launcher.js';
import {activityOwnerConfigDigest,type ActivityOwnerConfig} from '../../../src/runtime/conversation-activity/owner-runtime.js';
import {activityOwnerAddress} from '../../../src/runtime/conversation-activity/owner-protocol.js';
import {readProtectedOwnerQualification} from '../../../src/runtime/conversation-activity/owner-qualification.js';
import {activeOwnerServicePorts} from '../../electron/active-owner-service-ports.js';
import {ACTIVITY_STORAGE_NAMES} from '../../../src/runtime/conversation-activity/storage-permissions.js';

// 1.6.3 RC blocker: Desktop launched its owner from activity-owner-launch-<nonce>.json
// only, while Main qualifies every owner socket against activity-owner.config.json.
// On a protected (blank first start) root the owner could never be attached, so
// Main always took "starting KSwarm without it" on macOS and Windows alike.
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup();});
function blankRoot(){
 const root=mkdtempSync(join(tmpdir(),'owner-launch-qualification-')),runtime=new DesktopContextContinuity(root),p=runtime.port();
 cleanups.push(async()=>{await runtime.close();rmSync(root,{recursive:true,force:true});});
 const address=activityOwnerAddress(root),config:ActivityOwnerConfig={schemaVersion:1,dataRoot:address.dataRoot,profileId:p.actor.profileId,actorId:p.actor.actorId,identity:{kind:'desktop',path:join(address.dataRoot,'multi-agent','groups.sqlite')}};
 return {root,address,config};
}
function assertPrivate(path:string){
 if(process.platform!=='win32'){expect(statSync(path).mode&0o777).toBe(0o600);return;}
 // win32: chmodPrivateActivityFile is a no-op (as in 1.6.2 for every activity
 // file); the file keeps the profile's inherited ACL. Assert it is not exposed
 // to Everyone, BUILTIN\Users or Authenticated Users.
 const env={...process.env};delete env.PSModulePath;
 const out=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$a=[IO.File]::GetAccessControl('${path.replace(/'/g,"''")}');foreach($x in $a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){"sid=$($x.IdentityReference.Value) type=$($x.AccessControlType)"}`],{env,encoding:'utf8'});
 expect(out).toContain('sid=');
 for(const broad of ['S-1-1-0','S-1-5-32-545','S-1-5-11'])expect(out).not.toMatch(new RegExp(`sid=${broad} type=Allow`));
}
it('a Desktop owner launch config is qualifiable by Main on a blank protected root',async()=>{
 const {address,config}=blankRoot();
 // Blank first start: the profile exists, no owner was ever configured.
 expect(existsSync(join(address.dataRoot,ACTIVITY_STORAGE_NAMES.config))).toBe(false);
 expect(()=>readProtectedOwnerQualification(address.dataRoot)).toThrow('activity_owner_qualification_unavailable');
 const launchFile=writeOwnerLaunchConfig(address.dataRoot,'n'.repeat(32),config);
 expect(JSON.parse(readFileSync(launchFile,'utf8'))).toEqual(config);
 expect(readProtectedOwnerQualification(address.dataRoot)).toMatchObject({profileId:config.profileId,configDigest:activityOwnerConfigDigest(config)});
 assertPrivate(join(address.dataRoot,ACTIVITY_STORAGE_NAMES.config));assertPrivate(launchFile);
});
it('a config left by a dead owner is never attached and is replaced by the next launch',async()=>{
 const {address,config}=blankRoot(),stale={...config,kswarm:{url:'http://127.0.0.1:4401',brokerUrl:'http://127.0.0.1:4319',mutationToken:'old',roomToken:'old'}} as ActivityOwnerConfig;
 writeOwnerLaunchConfig(address.dataRoot,'o'.repeat(32),stale);
 // The owner that wrote it is gone: no socket answers, so discovery must not attach to it.
 await expect(activeOwnerServicePorts(address.dataRoot)).resolves.toBeUndefined();
 writeOwnerLaunchConfig(address.dataRoot,'n'.repeat(32),config);
 const qualified=readProtectedOwnerQualification(address.dataRoot)!;
 expect(qualified.configDigest).toBe(activityOwnerConfigDigest(config));expect(qualified.configDigest).not.toBe(activityOwnerConfigDigest(stale));
});
