import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({present:false,badPath:'',badKind:'',changed:false,changeOnSpawn:false,stdout:'drwxr-xr-x root wheel directory\n',status:0,signal:null as string|null,error:undefined as Error|undefined,calls:[] as Array<{path:string,args:string[],options:any}>,stats:[] as string[]}));
const macAncestors=['/Library/Application Support','/Library','/'];
vi.mock('node:fs',async load=>{const actual=await load<typeof import('node:fs')>();return {...actual,lstatSync(path:any,options?:any){
 const value=String(path);if(['/Library/Application Support/xiaok-verification','/var/lib/xiaok-verification'].includes(value)){if(!f.present)throw Object.assign(Error('absent'),{code:'ENOENT'});return {isDirectory:()=>true,isSymbolicLink:()=>false};}
 if(value==='/Library/Application Support/test-service'||value==='/Library/Application Support/test-service/marker.json')return {uid:501,mode:value.endsWith('.json')?0o100644:0o40755,nlink:1,isDirectory:()=>!value.endsWith('.json'),isFile:()=>value.endsWith('.json'),isSymbolicLink:()=>false};
 if(value.startsWith('/Library/Application Support/xiaok-verification/'))throw Object.assign(Error('missing installation component'),{code:'ENOENT'});
 if(['/Library/Application Support','/Library','/','/var/lib','/var'].includes(value)){
  f.stats.push(value);const bad=value===f.badPath,big=options?.bigint,number=(n:number)=>big?BigInt(n):n;
  return {dev:number(1),ino:number(f.changed&&value==='/Library'?44:10),uid:number(bad&&f.badKind==='owner'?501:0),mode:number(bad&&f.badKind==='mode'?0o40777:0o40755),ctimeNs:BigInt(f.changed?2:1),isDirectory:()=>!(bad&&f.badKind==='file'),isSymbolicLink:()=>bad&&f.badKind==='symlink'};
 }
 return actual.lstatSync(path,options);
}};});
vi.mock('node:child_process',async load=>{const actual=await load<typeof import('node:child_process')>();return {...actual,spawnSync(path:string,args:string[],options:any){f.calls.push({path,args,options});if(f.changeOnSpawn)f.changed=true;return{status:f.status,signal:f.signal,error:f.error,stdout:f.stdout,stderr:''};}};});
import {readInstalledCurrentProfile,assertServiceProtectedMarkerPath} from '../../../src/runtime/verification/migration-markers.js';
const platform=process.platform;
beforeEach(()=>{Object.defineProperty(process,'platform',{value:'darwin',configurable:true});Object.assign(f,{present:false,badPath:'',badKind:'',changed:false,changeOnSpawn:false,stdout:'drwxr-xr-x root wheel directory\n',status:0,signal:null,error:undefined,calls:[],stats:[]});});
afterEach(()=>Object.defineProperty(process,'platform',{value:platform,configurable:true}));
it('queries every fixed original ancestor in one actual reader invocation without a shell or cache',()=>{
 expect(readInstalledCurrentProfile().kind).toBe('ordinary');expect(f.calls).toHaveLength(1);
 expect(f.calls[0]).toMatchObject({path:'/bin/ls',args:['-lde',...macAncestors],options:{encoding:'utf8',env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},timeout:5000,maxBuffer:65536}});
 expect(f.calls[0].options.shell??false).toBe(false);expect(f.stats).toEqual([...macAncestors,...macAncestors]);
 expect(readInstalledCurrentProfile().kind).toBe('ordinary');expect(f.calls).toHaveLength(2);
});
it.each(['owner','mode','symlink','file'])('refuses invalid ancestor %s before spawning',kind=>{f.badPath='/Library';f.badKind=kind;expect(readInstalledCurrentProfile().kind).toBe('unavailable');expect(f.calls).toHaveLength(0);});
it.each(['acl','exit','signal','error'])('refuses the combined child outcome %s',kind=>{
 if(kind==='acl')f.stdout+=' 0: group:everyone deny delete\n';if(kind==='exit')f.status=1;if(kind==='signal')f.signal='SIGTERM';if(kind==='error')f.error=Error('ENOBUFS');
 expect(readInstalledCurrentProfile().kind).toBe('unavailable');
});
it('rejects an ancestor changed during the ACL query',()=>{f.changeOnSpawn=true;expect(readInstalledCurrentProfile().kind).toBe('unavailable');});
it('checks fixed installation existence again on the next call',()=>{expect(readInstalledCurrentProfile().kind).toBe('ordinary');f.present=true;expect(readInstalledCurrentProfile().kind).toBe('unavailable');});
it('checks every Linux ancestor without invoking the macOS ACL command',()=>{Object.defineProperty(process,'platform',{value:'linux',configurable:true});expect(readInstalledCurrentProfile().kind).toBe('ordinary');expect(f.calls).toHaveLength(0);expect(new Set(f.stats)).toEqual(new Set(['/var/lib','/var','/']));});

it('preserves the original service-owned descendant ACL checks',()=>{expect(()=>assertServiceProtectedMarkerPath('/Library/Application Support/test-service/marker.json',{root:'/Library/Application Support/test-service',serviceUid:501,kind:'file'})).not.toThrow();expect(f.calls.map(c=>c.args)).toEqual([['-lde',...macAncestors],['-lde','/Library/Application Support/test-service/marker.json'],['-lde','/Library/Application Support/test-service']]);});
