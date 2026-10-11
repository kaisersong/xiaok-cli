import {it,expect,vi,afterEach} from 'vitest';
import {createHash} from 'node:crypto';
import {dirname,win32} from 'node:path';
const fixture=vi.hoisted(()=>({missing:false,reply:'{"version":1,"kind":"ordinary"}',spawned:0,wrongHash:false,fsReads:0,nativeMachine:process.arch==='arm64'?'ARM64':'AMD64',machineError:false,spawnPath:undefined as string|undefined,spawnCwd:undefined as string|undefined,changedManifest:false,changedHelper:false}));
vi.mock('node:os',()=>({machine(){if(fixture.machineError)throw Error('OS machine unavailable');return fixture.nativeMachine;}}));
vi.mock('node:fs',()=>({
 lstatSync(){fixture.fsReads++;if(fixture.missing)throw Object.assign(Error('missing'),{code:'ENOENT'});return{isFile:()=>true,isSymbolicLink:()=>false,nlink:1,size:32};},
 readFileSync(path:string){fixture.fsReads++;if(path.endsWith('.json'))return Buffer.from(JSON.stringify({version:1,target:'win32-'+process.arch,sourceSha256:'1'.repeat(64),coreSha256:'2'.repeat(64),sha256:fixture.wrongHash||fixture.changedManifest&&fixture.spawned>0?'0'.repeat(64):createHash('sha256').update(Buffer.from('MZ-fixture-native-only')).digest('hex')}));return Buffer.from(fixture.changedHelper&&fixture.spawned>0?'MZ-changed-helper':'MZ-fixture-native-only');}
}));
vi.mock('node:child_process',()=>({spawnSync(path:string,args:string[],options:any){fixture.spawned++;fixture.spawnPath=path;fixture.spawnCwd=options.cwd;expect(path).toMatch(/windows-installation-absence\.exe$/);expect(args).toEqual([]);expect(options.shell).toBe(false);expect(options.env).toEqual({});return{status:0,stdout:Buffer.from(fixture.reply),stderr:Buffer.alloc(0)};}}));
import {readWindowsInstallationAbsence} from '../../../src/runtime/verification/windows-installation-absence.js';
const moduleImportCalls={fsReads:fixture.fsReads,spawned:fixture.spawned};
afterEach(()=>{vi.restoreAllMocks();fixture.missing=false;fixture.wrongHash=false;fixture.reply='{"version":1,"kind":"ordinary"}';fixture.spawned=0;fixture.fsReads=0;fixture.nativeMachine=process.arch==='arm64'?'ARM64':'AMD64';fixture.machineError=false;fixture.spawnPath=undefined;fixture.spawnCwd=undefined;fixture.changedManifest=false;fixture.changedHelper=false;});
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
