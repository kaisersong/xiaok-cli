import {it,expect,vi,afterEach} from 'vitest';
const fixture=vi.hoisted(()=>({active:false,missing:false,raw:'',boot:'550e8400-e29b-41d4-a716-446655440000',ps:0}));
vi.mock('node:child_process',async original=>({...await original<typeof import('node:child_process')>(),spawnSync(){fixture.ps++;return {error:Object.assign(Error('no ps'),{code:'ENOENT'}),status:null,stdout:''};}}));
vi.mock('node:fs',async original=>{const fs=await original<typeof import('node:fs')>();return {...fs,readFileSync(path:unknown,...args:unknown[]){
 if(fixture.active&&String(path).startsWith('/proc/')){
  if(fixture.missing)throw Object.assign(Error('hidden'),{code:'ENOENT'});
  return String(path).endsWith('boot_id')?fixture.boot:fixture.raw;
 }
 return Reflect.apply(fs.readFileSync,fs,[path,...args]);
}};});
import {probeProcessIdentity} from '../../../src/platform/provider-store/process-identity.js';
const platform=Object.getOwnPropertyDescriptor(process,'platform')!;
function linux<T>(run:()=>T):T{Object.defineProperty(process,'platform',{...platform,value:'linux'});try{return run();}finally{Object.defineProperty(process,'platform',platform);}}
function stat(pid:number,ticks:string,comm='name (with ) brackets)'){const fields=Array(20).fill('0');fields[0]='S';fields[19]=ticks;return `${pid} (${comm}) ${fields.join(' ')}`;}
afterEach(()=>{fixture.active=false;fixture.missing=false;fixture.ps=0;vi.restoreAllMocks();});
it('reads kernel start ticks after the final comm parenthesis without invoking ps',()=>{
 fixture.active=true;fixture.raw=stat(123,'456');const a=linux(()=>probeProcessIdentity(123));
 expect(a).toEqual({kind:'alive',identity:{pid:123,startIdentity:`linux-proc-v1:${fixture.boot}:456`}});
 fixture.raw=stat(123,'457');expect(linux(()=>probeProcessIdentity(123))).not.toEqual(a);expect(fixture.ps).toBe(0);
});
it('rejects wrong PID and malformed ticks rather than inventing identity',()=>{
 fixture.active=true;fixture.raw=stat(124,'456');expect(linux(()=>probeProcessIdentity(123)).kind).toBe('unknown');
 fixture.raw=stat(123,'bad');expect(linux(()=>probeProcessIdentity(123)).kind).toBe('unknown');
});
it('missing proc data is dead only after ESRCH, never when the PID is still live or denied',()=>{
 fixture.active=true;fixture.missing=true;
 vi.spyOn(process,'kill').mockImplementation(()=>true);expect(linux(()=>probeProcessIdentity(123)).kind).toBe('unknown');
 vi.mocked(process.kill).mockImplementation(()=>{throw Object.assign(Error('denied'),{code:'EPERM'});});expect(linux(()=>probeProcessIdentity(123)).kind).toBe('unknown');
 vi.mocked(process.kill).mockImplementation(()=>{throw Object.assign(Error('dead'),{code:'ESRCH'});});expect(linux(()=>probeProcessIdentity(123)).kind).toBe('dead');
});
it.skipIf(process.platform!=='linux')('real Linux current process works with the ps executable unavailable',()=>{
 expect(probeProcessIdentity(process.pid)).toMatchObject({kind:'alive',identity:{pid:process.pid,startIdentity:expect.stringMatching(/^linux-proc-v1:/)}});expect(fixture.ps).toBe(0);
});
