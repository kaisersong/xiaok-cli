// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {mkdirSync,mkdtempSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';import {createServer,type Server} from 'node:net';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';import {spawn} from 'node:child_process';import {existsSync} from 'node:fs';
import {DesktopContextContinuity} from '../../electron/context-continuity/runtime.js';
import {resolveDesktopServiceScope} from '../../electron/desktop-service-scope.js';
import {mainActivityOwnerConfig} from '../../electron/activity-owner-main-config.js';
import {writeOwnerLaunchConfig} from '../../electron/activity-owner-writer-launcher.js';
import {activeOwnerServicePorts} from '../../electron/active-owner-service-ports.js';
import {activityOwnerAddress} from '../../../src/runtime/conversation-activity/owner-protocol.js';
import {readProtectedOwnerQualification} from '../../../src/runtime/conversation-activity/owner-qualification.js';

// 1.6.3 RC blocker (#233, CTO kmm smoke 15:4x): a 1.6.2 Desktop data root reached
// through a symlink (macOS /tmp -> /private/tmp) kept its old owner config:
// profileId hashed from the unresolved path, dataRoot stored as realpath, no
// profileRoot. It never qualified, preparePorts() threw on every start
// ("Service bootstrap refused") and the config was never rewritten.
const cleanups:Array<()=>Promise<void>|void>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
function tempDir(prefix:string){const dir=mkdtempSync(join(tmpdir(),prefix));cleanups.push(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
async function symlinkedProfile(){
 const real=tempDir('ports-legacy-real-'),parent=tempDir('ports-legacy-link-'),link=join(parent,'tmp');
 symlinkSync(real,link,process.platform==='win32'?'junction':'dir');
 mkdirSync(join(real,'xiaok-desktop'));const dataRoot=join(link,'xiaok-desktop');
 const runtime=new DesktopContextContinuity(dataRoot);runtime.port();cleanups.push(()=>runtime.close());
 mkdirSync(join(dataRoot,'multi-agent'),{recursive:true});writeFileSync(join(dataRoot,'multi-agent','groups.sqlite'),'');
 return {dataRoot,address:activityOwnerAddress(dataRoot)};
}
// The 1.6.2 writer: id from the path Main was given, dataRoot normalized to realpath, no profileRoot.
function legacyConfig(dataRoot:string,root:string,profileId=resolveDesktopServiceScope({dataRoot}).profileId){
 const config={schemaVersion:1,dataRoot:root,profileId,actorId:`desktop-user:${profileId}`,identity:{kind:'desktop',path:join(root,'multi-agent','groups.sqlite')},
  kswarm:{url:'http://127.0.0.1:14400',brokerUrl:'http://127.0.0.1:14318',mutationToken:'old',roomToken:'old'}};
 writeFileSync(join(root,'activity-owner.config.json'),JSON.stringify(config),{mode:0o600});
 return config;
}
it('a 1.6.2 config under a symlinked data root with no live owner is treated as no owner and the next launch rewrites it',async()=>{
 const {dataRoot,address}=await symlinkedProfile();
 expect(address.dataRoot).toBe(realpathSync(dataRoot));expect(address.dataRoot).not.toBe(dataRoot);
 legacyConfig(dataRoot,address.dataRoot);
 // The upgrade state CTO saw on kmm: the old config does not qualify.
 expect(()=>readProtectedOwnerQualification(address.dataRoot)).toThrow('activity_owner_qualification_unavailable');
 await expect(activeOwnerServicePorts(dataRoot)).resolves.toBeUndefined();
 // What the launcher then writes (desktop-services -> mainActivityOwnerConfig -> writeOwnerLaunchConfig).
 const scope=resolveDesktopServiceScope({dataRoot}),config=mainActivityOwnerConfig(dataRoot,scope.profileId,{});
 writeOwnerLaunchConfig(address.dataRoot,'u'.repeat(32),{...config,dataRoot:address.dataRoot});
 expect(readProtectedOwnerQualification(address.dataRoot)).toMatchObject({profileId:scope.profileId});
});
it('a live owner behind a forged (unqualifiable) config is still refused',async()=>{
 const {dataRoot,address}=await symlinkedProfile();
 legacyConfig(dataRoot,address.dataRoot,createHash('sha256').update('forged').digest('hex'));
 const server:Server=createServer(socket=>socket.destroy());
 await new Promise<void>((yes,no)=>{server.once('error',no);server.listen(address.socketPath,()=>yes());});
 cleanups.push(()=>new Promise<void>(yes=>server.close(()=>yes())));
 await expect(activeOwnerServicePorts(dataRoot)).rejects.toThrow('activity_owner_qualification_unavailable');
});
it('a stale owner socket left by a killed owner process counts as no live owner',async()=>{
 const {dataRoot,address}=await symlinkedProfile();
 legacyConfig(dataRoot,address.dataRoot);
 // A real owner-like process listens on the owner socket and is then killed, so its pid is dead.
 const child=spawn(process.execPath,['-e',`require('node:net').createServer(()=>{}).listen(${JSON.stringify(address.socketPath)},()=>process.stdout.write('up'))`],{stdio:['ignore','pipe','inherit'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
 cleanups.push(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
 await new Promise<void>((yes,no)=>{child.stdout!.once('data',()=>yes());child.once('exit',()=>no(Error('listener exited early')));});
 const exited=new Promise<void>(yes=>child.once('exit',()=>yes()));child.kill('SIGKILL');await exited;
 // POSIX keeps the socket file with nobody listening (ECONNREFUSED); a Windows pipe disappears (ENOENT).
 if(process.platform!=='win32')expect(existsSync(address.socketPath)).toBe(true);
 await expect(activeOwnerServicePorts(dataRoot)).resolves.toBeUndefined();
});
