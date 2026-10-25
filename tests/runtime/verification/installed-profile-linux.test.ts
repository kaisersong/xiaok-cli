import {it,expect,vi} from 'vitest';
const fixture=vi.hoisted(()=>({installed:false}));
vi.mock('node:fs',async importOriginal=>{const actual=await importOriginal<typeof import('node:fs')>();return {...actual,lstatSync:(path:any,...args:any[])=>{
 const bigintStat={isDirectory:()=>true,isSymbolicLink:()=>false,uid:0n,mode:0o755n,dev:0n,ino:0n,ctimeNs:0n};
 if(String(path)==='/var/lib/xiaok-verification'){if(!fixture.installed)throw Object.assign(Error('absent'),{code:'ENOENT'});return {isDirectory:()=>true,isSymbolicLink:()=>false,uid:0,mode:0o755};}
 if(['/var','/var/lib'].includes(String(path)))return {...bigintStat};return (actual.lstatSync as any)(path,...args);
}};});
import {readInstalledCurrentProfile} from '../../../src/runtime/verification/migration-markers.js';
it('preserves ordinary Linux owners only for verified absence of the fixed installation root',()=>{
 const actual=process;vi.stubGlobal('process',new Proxy(actual,{get(target,key){return key==='platform'?'linux':Reflect.get(target,key);}}));
 try{fixture.installed=false;expect(readInstalledCurrentProfile()).toEqual({kind:'ordinary'});fixture.installed=true;expect(readInstalledCurrentProfile()).toEqual({kind:'unavailable',reason:'migration_authority_unavailable'});}finally{vi.unstubAllGlobals();}
});
