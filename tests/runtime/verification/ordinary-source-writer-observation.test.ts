import {it,expect,vi,afterEach} from 'vitest';
import {createHash} from 'node:crypto';
const fixture=vi.hoisted(()=>({missing:false,reply:'{"version":1,"kind":"ordinary"}',spawned:0,wrongHash:false,accountCalls:0}));
vi.mock('node:fs',async load=>{const actual=await load<typeof import('node:fs')>();return{...actual,
 lstatSync(path:any,...args:any[]){if(String(path).includes('windows-installation-absence.')){if(fixture.missing)throw Object.assign(Error('missing'),{code:'ENOENT'});return{isFile:()=>true,isSymbolicLink:()=>false,nlink:1,size:32};}return Reflect.apply(actual.lstatSync,actual,[path,...args]);},
 readFileSync(path:any,...args:any[]){if(String(path).includes('windows-installation-absence.')){if(String(path).endsWith('.json'))return Buffer.from(JSON.stringify({version:1,target:'win32-'+process.arch,sourceSha256:'1'.repeat(64),coreSha256:'2'.repeat(64),sha256:fixture.wrongHash?'0'.repeat(64):createHash('sha256').update(Buffer.from('MZ-fixture-native-only')).digest('hex')}));return Buffer.from('MZ-fixture-native-only');}return Reflect.apply(actual.readFileSync,actual,[path,...args]);}
};});
vi.mock('node:child_process',async load=>{const actual=await load<typeof import('node:child_process')>();return {...actual,spawnSync(path:string,args:string[],options:any){if(!path.endsWith('windows-installation-absence.exe'))throw Error('unexpected helper');fixture.spawned++;expect(args).toEqual([]);expect(options.shell).toBe(false);expect(options.env).toEqual({});return{status:0,stdout:Buffer.from(fixture.reply),stderr:Buffer.alloc(0)};}};});
vi.mock('node:os',async load=>{const actual=await load<typeof import('node:os')>();return {...actual,userInfo(){fixture.accountCalls++;throw Error('Windows POSIX account access');}};});
import {assertOrdinarySourceWriterRoute,observeOrdinarySQLiteWriter,observeOrdinaryDirectoryWriter} from '../../../src/runtime/verification/ordinary-source-writer-observation.js';
const originalPlatform=process.platform;
afterEach(()=>{Object.defineProperty(process,'platform',{value:originalPlatform,configurable:true});fixture.missing=false;fixture.wrongHash=false;fixture.reply='{"version":1,"kind":"ordinary"}';fixture.spawned=0;fixture.accountCalls=0;});
it('uses the original full Windows absence reader before skipping POSIX-only discovery',()=>{
 Object.defineProperty(process,'platform',{value:'win32',configurable:true});
 assertOrdinarySourceWriterRoute();observeOrdinarySQLiteWriter('C:\\ordinary\\native.sqlite','codex-native-sqlite-v1');observeOrdinaryDirectoryWriter('C:\\ordinary\\tasks','task-root');expect(fixture.spawned).toBe(3);expect(fixture.accountCalls).toBe(0);
});
it.each(['installed','unavailable','malformed'])('refuses the real absence-reader outcome %s without touching the registry',kind=>{
 Object.defineProperty(process,'platform',{value:'win32',configurable:true});fixture.reply=kind==='malformed'?'garbage':JSON.stringify({version:1,kind});
 expect(()=>assertOrdinarySourceWriterRoute()).toThrow('ordinary_source_route');expect(()=>observeOrdinarySQLiteWriter('C:\\ordinary\\native.sqlite','codex-native-sqlite-v1')).toThrow('ordinary_source_route');expect(()=>observeOrdinaryDirectoryWriter('C:\\ordinary\\tasks','task-root')).toThrow('ordinary_source_route');expect(fixture.spawned).toBe(3);expect(fixture.accountCalls).toBe(0);
});
it.each(['missing','changed'])('refuses %s original packaged helper before any spawn',kind=>{
 Object.defineProperty(process,'platform',{value:'win32',configurable:true});fixture.missing=kind==='missing';fixture.wrongHash=kind==='changed';
 expect(()=>observeOrdinarySQLiteWriter('C:\\ordinary\\native.sqlite','codex-native-sqlite-v1')).toThrow('ordinary_source_route');expect(()=>observeOrdinaryDirectoryWriter('C:\\ordinary\\tasks','task-root')).toThrow('ordinary_source_route');expect(fixture.spawned).toBe(0);expect(fixture.accountCalls).toBe(0);
});
