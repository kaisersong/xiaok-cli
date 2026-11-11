import {it,expect,vi,afterEach} from 'vitest';
import {createHash} from 'node:crypto';
import {dirname,win32} from 'node:path';
const fixture=vi.hoisted(()=>({missing:false,reply:'{"version":1,"kind":"ordinary"}',spawned:0,wrongHash:false,fsReads:0,nativeMachine:process.arch==='arm64'?'ARM64':'AMD64',machineError:false,spawnPath:undefined as string|undefined,spawnCwd:undefined as string|undefined,changedManifest:false,changedHelper:false,identity:undefined as undefined|Record<'helper'|'manifest',{dev:bigint;ino:bigint;size:bigint;mtimeNs:bigint;ctimeNs:bigint}>,helperBytes:undefined as Buffer|undefined,manifestSha256:undefined as string|undefined,helperReads:0,manifestReads:0,spawnFails:false}));
vi.mock('node:os',()=>({machine(){if(fixture.machineError)throw Error('OS machine unavailable');return fixture.nativeMachine;}}));
vi.mock('node:fs',()=>({
 lstatSync(path:string,options?:{bigint?:boolean}){fixture.fsReads++;if(fixture.missing)throw Object.assign(Error('missing'),{code:'ENOENT'});if(options?.bigint&&fixture.identity){const id=fixture.identity[path.endsWith('.json')?'manifest':'helper'];return{isFile:()=>true,isSymbolicLink:()=>false,nlink:1n,...id};}return{isFile:()=>true,isSymbolicLink:()=>false,nlink:1,size:32};},
 readFileSync(path:string){fixture.fsReads++;if(path.endsWith('.json')){fixture.manifestReads++;return Buffer.from(JSON.stringify({version:1,target:'win32-'+process.arch,sourceSha256:'1'.repeat(64),coreSha256:'2'.repeat(64),sha256:fixture.wrongHash||fixture.changedManifest&&fixture.spawned>0?'0'.repeat(64):fixture.manifestSha256??createHash('sha256').update(Buffer.from('MZ-fixture-native-only')).digest('hex')}));}fixture.helperReads++;return fixture.helperBytes??Buffer.from(fixture.changedHelper&&fixture.spawned>0?'MZ-changed-helper':'MZ-fixture-native-only');}
}));
vi.mock('node:child_process',()=>({spawnSync(path:string,args:string[],options:any){fixture.spawned++;fixture.spawnPath=path;fixture.spawnCwd=options.cwd;expect(path).toMatch(/windows-installation-absence\.exe$/);expect(args).toEqual([]);expect(options.shell).toBe(false);expect(options.env).toEqual({});if(fixture.spawnFails)return{status:null,error:Error('spawn failed'),stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)};return{status:0,stdout:Buffer.from(fixture.reply),stderr:Buffer.alloc(0)};}}));
import {readWindowsInstallationAbsence} from '../../../src/runtime/verification/windows-installation-absence.js';
const moduleImportCalls={fsReads:fixture.fsReads,spawned:fixture.spawned};
afterEach(()=>{vi.restoreAllMocks();fixture.missing=false;fixture.wrongHash=false;fixture.reply='{"version":1,"kind":"ordinary"}';fixture.spawned=0;fixture.fsReads=0;fixture.nativeMachine=process.arch==='arm64'?'ARM64':'AMD64';fixture.machineError=false;fixture.spawnPath=undefined;fixture.spawnCwd=undefined;fixture.changedManifest=false;fixture.changedHelper=false;fixture.identity=undefined;fixture.helperBytes=undefined;fixture.manifestSha256=undefined;fixture.helperReads=0;fixture.manifestReads=0;fixture.spawnFails=false;
 // The integrity memo is process-lifetime: end every case with an identity-less
 // call, which never hits and drops any memo, so cases stay independent.
 const platform=vi.spyOn(process,'platform','get').mockReturnValue('win32');readWindowsInstallationAbsence();platform.mockRestore();fixture.spawned=0;fixture.fsReads=0;fixture.helperReads=0;fixture.manifestReads=0;});
it('gates the Windows helper before any filesystem or spawn on other platforms',()=>{vi.spyOn(process,'platform','get').mockReturnValue('darwin');expect(readWindowsInstallationAbsence()).toBe('unavailable');expect(fixture.spawned).toBe(0);expect(fixture.fsReads).toBe(0);});
it('missing or mismatched packaged helper never grants ordinary',()=>{vi.spyOn(process,'platform','get').mockReturnValue('win32');fixture.missing=true;expect(readWindowsInstallationAbsence()).toBe('unavailable');fixture.missing=false;fixture.wrongHash=true;expect(readWindowsInstallationAbsence()).toBe('unavailable');expect(fixture.spawned).toBe(0);});
it('accepts only the fixed native reply schema, and never maps installed or unknown to ordinary',()=>{
 vi.spyOn(process,'platform','get').mockReturnValue('win32');expect(readWindowsInstallationAbsence()).toBe('ordinary');
 for(const reply of ['{"version":1,"kind":"installed"}','{"version":1,"kind":"unavailable"}','{"version":1,"kind":"ordinary","root":"user-choice"}','garbage']){fixture.reply=reply;expect(readWindowsInstallationAbsence()).not.toBe('ordinary');}
});

for(const [arch,nativeMachine] of [['x64','AMD64'],['x64','x86_64'],['arm64','ARM64'],['arm64','aarch64']] as const){
 it(`accepts only matching native ${arch}/${nativeMachine} before fixed helper execution`,()=>{
  vi.spyOn(process,'platform','get').mockReturnValue('win32');vi.spyOn(process,'arch','get').mockReturnValue(arch);fixture.nativeMachine=nativeMachine;
  expect(readWindowsInstallationAbsence()).toBe('ordinary');expect(fixture.spawned).toBe(1);expect(fixture.fsReads).toBeGreaterThan(0);
 });
}
for(const [arch,nativeMachine] of [['x64','ARM64'],['arm64','AMD64'],['x64','unknown'],['arm64',''],['ia32','AMD64']] as const){
 it(`denies ${arch}/${nativeMachine} before any filesystem or spawn`,()=>{
  vi.spyOn(process,'platform','get').mockReturnValue('win32');vi.spyOn(process,'arch','get').mockReturnValue(arch);fixture.nativeMachine=nativeMachine;
  expect(readWindowsInstallationAbsence()).toBe('unavailable');expect(fixture.spawned).toBe(0);expect(fixture.fsReads).toBe(0);
 });
}
it('an unavailable native machine query denies before any filesystem or spawn',()=>{
 vi.spyOn(process,'platform','get').mockReturnValue('win32');fixture.machineError=true;
 expect(readWindowsInstallationAbsence()).toBe('unavailable');expect(fixture.fsReads).toBe(0);expect(fixture.spawned).toBe(0);
});
it('arguments cannot bypass the native machine or fixed helper path',()=>{
 vi.spyOn(process,'platform','get').mockReturnValue('win32');
 expect((readWindowsInstallationAbsence as (...args:unknown[])=>string)('override')).toBe('unavailable');expect(fixture.fsReads).toBe(0);expect(fixture.spawned).toBe(0);
});

it('module initialization has no filesystem or spawn side effects',()=>{expect(moduleImportCalls.fsReads).toBe(0);expect(moduleImportCalls.spawned).toBe(0);});

it('converts only the verified fixed helper and its directory for Windows native spawning',()=>{
 vi.spyOn(process,'platform','get').mockReturnValue('win32');
 const namespace=vi.spyOn(win32,'toNamespacedPath').mockImplementation(path=>'NAMESPACE:'+path);
 expect(readWindowsInstallationAbsence()).toBe('ordinary');
 expect(namespace).toHaveBeenCalledTimes(2);
 const helper=namespace.mock.calls[0]![0];
 expect(helper).toMatch(/windows-installation-absence\.exe$/);
 expect(namespace.mock.calls[1]).toEqual([dirname(helper)]);
 expect(fixture.spawnPath).toBe('NAMESPACE:'+helper);expect(fixture.spawnCwd).toBe('NAMESPACE:'+dirname(helper));
});
it('keeps missing and mismatched helpers denied before namespace conversion',()=>{
 vi.spyOn(process,'platform','get').mockReturnValue('win32');const namespace=vi.spyOn(win32,'toNamespacedPath');
 fixture.missing=true;expect(readWindowsInstallationAbsence()).toBe('unavailable');
 fixture.missing=false;fixture.wrongHash=true;expect(readWindowsInstallationAbsence()).toBe('unavailable');
 expect(namespace).not.toHaveBeenCalled();expect(fixture.spawned).toBe(0);
});
it('denies failed namespace conversion without invoking a fallback executable',()=>{
 vi.spyOn(process,'platform','get').mockReturnValue('win32');
 vi.spyOn(win32,'toNamespacedPath').mockImplementation(()=>{throw Error('namespace failure');});
 expect(readWindowsInstallationAbsence()).toBe('unavailable');expect(fixture.spawned).toBe(0);
});
for(const changed of ['changedManifest','changedHelper'] as const)it(`rejects ${changed} after the fixed native process returns`,()=>{
 vi.spyOn(process,'platform','get').mockReturnValue('win32');fixture[changed]=true;
 expect(readWindowsInstallationAbsence()).toBe('unavailable');expect(fixture.spawned).toBe(1);
});

// Integrity memo: only manifest parse + helper sha256 are reused, bound to the
// identity (dev/ino/size/mtimeNs/ctimeNs) of both files. The helper probes system
// state, so its process runs on every call.
const identityOf=(seed:bigint,size=22n)=>({dev:1n,ino:seed,size,mtimeNs:1_000_000_000n*seed,ctimeNs:1_000_000_000n*seed});
function stableFiles(){fixture.identity={helper:identityOf(10n),manifest:identityOf(20n,200n)};}
it('reuses the verified integrity for an unchanged identity but spawns the helper on every call',()=>{
 vi.spyOn(process,'platform','get').mockReturnValue('win32');stableFiles();
 expect(readWindowsInstallationAbsence()).toBe('ordinary');
 expect(fixture.helperReads).toBe(1);expect(fixture.manifestReads).toBe(2);expect(fixture.spawned).toBe(1);
 for(let call=2;call<=5;call++){expect(readWindowsInstallationAbsence()).toBe('ordinary');expect(fixture.spawned).toBe(call);}
 // No re-read or re-hash after the first verified call; one process per call.
 expect(fixture.helperReads).toBe(1);expect(fixture.manifestReads).toBe(2);expect(fixture.spawned).toBe(5);
});
it('never reuses a helper answer: a changed system answer is seen on the next call',()=>{
 vi.spyOn(process,'platform','get').mockReturnValue('win32');stableFiles();
 expect(readWindowsInstallationAbsence()).toBe('ordinary');
 fixture.reply='{"version":1,"kind":"installed"}';expect(readWindowsInstallationAbsence()).toBe('installed');
 fixture.reply='{"version":1,"kind":"ordinary"}';expect(readWindowsInstallationAbsence()).toBe('ordinary');
 expect(fixture.spawned).toBe(3);
});
for(const field of ['size','ino','mtimeNs','ctimeNs','dev'] as const)for(const file of ['helper','manifest'] as const)it(`a changed ${file} ${field} runs the full integrity check again`,()=>{
 vi.spyOn(process,'platform','get').mockReturnValue('win32');stableFiles();
 expect(readWindowsInstallationAbsence()).toBe('ordinary');expect(fixture.helperReads).toBe(1);
 fixture.identity![file]={...fixture.identity![file],[field]:fixture.identity![file][field]+1n};
 expect(readWindowsInstallationAbsence()).toBe('ordinary');
 expect(fixture.helperReads).toBe(2);expect(fixture.manifestReads).toBe(4);expect(fixture.spawned).toBe(2);
 // The new identity is then the memo key.
 expect(readWindowsInstallationAbsence()).toBe('ordinary');expect(fixture.helperReads).toBe(2);expect(fixture.spawned).toBe(3);
});
it('replaced helper content (size + mtime change) is re-hashed and spawned, and a mismatch is denied',()=>{
 vi.spyOn(process,'platform','get').mockReturnValue('win32');stableFiles();
 expect(readWindowsInstallationAbsence()).toBe('ordinary');
 fixture.helperBytes=Buffer.from('MZ-replaced-helper-bytes');fixture.identity!.helper={...fixture.identity!.helper,size:24n,mtimeNs:fixture.identity!.helper.mtimeNs+1n};
 expect(readWindowsInstallationAbsence()).toBe('unavailable');
 expect(fixture.helperReads).toBe(2);expect(fixture.spawned).toBe(1);
 // A matching manifest for the replacement verifies fully and then spawns.
 fixture.manifestSha256=createHash('sha256').update(fixture.helperBytes).digest('hex');fixture.identity!.manifest={...fixture.identity!.manifest,mtimeNs:fixture.identity!.manifest.mtimeNs+1n};
 expect(readWindowsInstallationAbsence()).toBe('ordinary');
 expect(fixture.helperReads).toBe(3);expect(fixture.spawned).toBe(2);
});
it('drops the memo on a failed spawn, an unavailable answer, or a missing helper, so the next call verifies fully',()=>{
 vi.spyOn(process,'platform','get').mockReturnValue('win32');stableFiles();
 expect(readWindowsInstallationAbsence()).toBe('ordinary');expect(fixture.helperReads).toBe(1);
 fixture.spawnFails=true;expect(readWindowsInstallationAbsence()).toBe('unavailable');expect(fixture.helperReads).toBe(1);
 fixture.spawnFails=false;expect(readWindowsInstallationAbsence()).toBe('ordinary');expect(fixture.helperReads).toBe(2);
 fixture.reply='{"version":1,"kind":"unavailable"}';expect(readWindowsInstallationAbsence()).toBe('unavailable');
 fixture.reply='{"version":1,"kind":"ordinary"}';expect(readWindowsInstallationAbsence()).toBe('ordinary');expect(fixture.helperReads).toBe(3);
 fixture.missing=true;expect(readWindowsInstallationAbsence()).toBe('unavailable');
 fixture.missing=false;expect(readWindowsInstallationAbsence()).toBe('ordinary');expect(fixture.helperReads).toBe(4);
 expect(fixture.spawned).toBe(6);
});
it('an unavailable helper that later becomes valid is seen with a full check',()=>{
 vi.spyOn(process,'platform','get').mockReturnValue('win32');stableFiles();fixture.wrongHash=true;
 expect(readWindowsInstallationAbsence()).toBe('unavailable');expect(fixture.spawned).toBe(0);
 fixture.wrongHash=false;
 expect(readWindowsInstallationAbsence()).toBe('ordinary');expect(fixture.helperReads).toBe(2);expect(fixture.spawned).toBe(1);
});
it('an identity that changes during the first check is never memoized',()=>{
 vi.spyOn(process,'platform','get').mockReturnValue('win32');stableFiles();
 let bump=0n;const original=fixture.identity!;
 fixture.identity=new Proxy(original,{get(target,file:'helper'|'manifest'){return file==='helper'?{...target.helper,mtimeNs:target.helper.mtimeNs+(bump++)}:target[file];}});
 expect(readWindowsInstallationAbsence()).toBe('ordinary');expect(readWindowsInstallationAbsence()).toBe('ordinary');
 // Every call re-reads (and re-hashes before and after the process).
 expect(fixture.helperReads).toBe(4);expect(fixture.spawned).toBe(2);
});
it('without readable identity every call keeps the full original check',()=>{
 vi.spyOn(process,'platform','get').mockReturnValue('win32');
 expect(readWindowsInstallationAbsence()).toBe('ordinary');expect(readWindowsInstallationAbsence()).toBe('ordinary');
 expect(fixture.helperReads).toBe(4);expect(fixture.manifestReads).toBe(6);expect(fixture.spawned).toBe(2);
});
