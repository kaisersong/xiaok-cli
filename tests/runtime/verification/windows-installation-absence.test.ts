import {it,expect,vi,afterEach} from 'vitest';
import {createHash} from 'node:crypto';
const fixture=vi.hoisted(()=>({missing:false,reply:'{"version":1,"kind":"ordinary"}',spawned:0,wrongHash:false}));
vi.mock('node:fs',()=>({
 lstatSync(){if(fixture.missing)throw Object.assign(Error('missing'),{code:'ENOENT'});return{isFile:()=>true,isSymbolicLink:()=>false,nlink:1,size:32};},
 readFileSync(path:string){if(path.endsWith('.json'))return Buffer.from(JSON.stringify({version:1,target:'win32-'+process.arch,sourceSha256:'1'.repeat(64),coreSha256:'2'.repeat(64),sha256:fixture.wrongHash?'0'.repeat(64):createHash('sha256').update(Buffer.from('MZ-fixture-native-only')).digest('hex')}));return Buffer.from('MZ-fixture-native-only');}
}));
vi.mock('node:child_process',()=>({spawnSync(path:string,args:string[],options:any){fixture.spawned++;expect(path).toMatch(/windows-installation-absence\.exe$/);expect(args).toEqual([]);expect(options.shell).toBe(false);expect(options.env).toEqual({});return{status:0,stdout:Buffer.from(fixture.reply),stderr:Buffer.alloc(0)};}}));
import {readWindowsInstallationAbsence} from '../../../src/runtime/verification/windows-installation-absence.js';
afterEach(()=>{vi.restoreAllMocks();fixture.missing=false;fixture.wrongHash=false;fixture.reply='{"version":1,"kind":"ordinary"}';fixture.spawned=0;});
it('gates the Windows helper before any filesystem or spawn on other platforms',()=>{vi.spyOn(process,'platform','get').mockReturnValue('darwin');expect(readWindowsInstallationAbsence()).toBe('unavailable');expect(fixture.spawned).toBe(0);});
it('missing or mismatched packaged helper never grants ordinary',()=>{vi.spyOn(process,'platform','get').mockReturnValue('win32');fixture.missing=true;expect(readWindowsInstallationAbsence()).toBe('unavailable');fixture.missing=false;fixture.wrongHash=true;expect(readWindowsInstallationAbsence()).toBe('unavailable');expect(fixture.spawned).toBe(0);});
it('accepts only the fixed native reply schema, and never maps installed or unknown to ordinary',()=>{
 vi.spyOn(process,'platform','get').mockReturnValue('win32');expect(readWindowsInstallationAbsence()).toBe('ordinary');
 for(const reply of ['{"version":1,"kind":"installed"}','{"version":1,"kind":"unavailable"}','{"version":1,"kind":"ordinary","root":"user-choice"}','garbage']){fixture.reply=reply;expect(readWindowsInstallationAbsence()).not.toBe('ordinary');}
});
