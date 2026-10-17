import {expect,it} from 'vitest';
import {createRequire} from 'node:module';
import {installTestAccountHome} from './profile-account.setup.mjs';
const require=createRequire(import.meta.url),nativeOs=require('node:os');
const originalInfo=nativeOs.userInfo,originalHome=nativeOs.homedir;
function fixture(){
 const os={userInfo:(options?:unknown)=>Reflect.apply(originalInfo,nativeOs,[options]),homedir:()=>Reflect.apply(originalHome,nativeOs,[])};
 return {os,info:Object.getOwnPropertyDescriptor(os,'userInfo')!,home:Object.getOwnPropertyDescriptor(os,'homedir')!};
}
function messages(error:unknown):string[]{return error instanceof AggregateError?error.errors.flatMap(messages):[String(error instanceof Error?error.message:error)];}
it('changes only home while preserving native account fields, buffer encoding and PID',()=>{
 const f=fixture(),pid=process.pid;let cleanup=()=>{};
 installTestAccountHome(f.os,'/isolated-account',(fn:()=>void)=>{cleanup=fn;},()=>{});
 for(const options of [undefined,{encoding:'buffer'}]){
  const expected=Reflect.apply(originalInfo,nativeOs,[options]),actual=f.os.userInfo(options);
  const {homedir:priorHome,...priorFields}=expected,{homedir:nextHome,...nextFields}=actual;
  expect(nextFields).toEqual(priorFields);
  expect(nextHome).toEqual(Buffer.isBuffer(priorHome)?Buffer.from('/isolated-account'):'/isolated-account');
  if(process.getuid)expect(actual.uid).toBe(process.getuid());
 }
 expect(f.os.homedir()).toBe('/isolated-account');expect(process.pid).toBe(pid);cleanup();
});
it('preserves original property flags and restores exact descriptors',()=>{
 const f=fixture();let cleanup=()=>{};
 installTestAccountHome(f.os,'/isolated-account',(fn:()=>void)=>{cleanup=fn;},()=>{});
 const installed=Object.getOwnPropertyDescriptor(f.os,'userInfo')!;
 expect({...installed,value:f.info.value}).toEqual(f.info);cleanup();cleanup();
 expect(Object.getOwnPropertyDescriptor(f.os,'userInfo')).toEqual(f.info);
 expect(Object.getOwnPropertyDescriptor(f.os,'homedir')).toEqual(f.home);
});
it('reports a foreign replacement without overwriting it and restores the other entry',()=>{
 const f=fixture();let cleanup=()=>{};
 installTestAccountHome(f.os,'/isolated-account',(fn:()=>void)=>{cleanup=fn;},()=>{});
 const foreign=()=>({homedir:'foreign'});f.os.userInfo=foreign as typeof f.os.userInfo;
 let error;try{cleanup();}catch(value){error=value;}
 expect(messages(error)).toContain('test_profile_account_restoration_conflict:userInfo');
 expect(f.os.userInfo).toBe(foreign);expect(Object.getOwnPropertyDescriptor(f.os,'homedir')).toEqual(f.home);
});
it('reports a foreign flag change while preserving the changed descriptor',()=>{
 const f=fixture();let cleanup=()=>{};
 installTestAccountHome(f.os,'/isolated-account',(fn:()=>void)=>{cleanup=fn;},()=>{});
 Object.defineProperty(f.os,'userInfo',{writable:false});const foreign=Object.getOwnPropertyDescriptor(f.os,'userInfo');
 expect(()=>cleanup()).toThrow('test_profile_account_restore_failed');
 expect(Object.getOwnPropertyDescriptor(f.os,'userInfo')).toEqual(foreign);
 expect(Object.getOwnPropertyDescriptor(f.os,'homedir')).toEqual(f.home);
});
it('attempts the other restore and synchronization when one defineProperty fails',()=>{
 const f=fixture();let cleanup=()=>{},syncCalls=0;
 const os=new Proxy(f.os,{defineProperty(target,key,descriptor){if(key==='userInfo'&&descriptor.value===f.info.value)throw Error('restore info denied');return Reflect.defineProperty(target,key,descriptor);}});
 installTestAccountHome(os,'/isolated-account',(fn:()=>void)=>{cleanup=fn;},()=>{syncCalls++;});
 let error;try{cleanup();}catch(value){error=value;}
 expect(messages(error)).toContain('restore info denied');
 expect(Object.getOwnPropertyDescriptor(f.os,'homedir')).toEqual(f.home);expect(syncCalls).toBe(2);
});
it('does not mutate native descriptors if cleanup hook registration fails',()=>{
 const f=fixture();let syncCalls=0;
 expect(()=>installTestAccountHome(f.os,'/isolated-account',()=>{throw Error('hook denied');},()=>{syncCalls++;})).toThrow('hook denied');
 expect(Object.getOwnPropertyDescriptor(f.os,'userInfo')).toEqual(f.info);
 expect(Object.getOwnPropertyDescriptor(f.os,'homedir')).toEqual(f.home);expect(syncCalls).toBe(0);
});
it('rolls back the first patch if the second installation fails',()=>{
 const f=fixture();Object.defineProperty(f.os,'homedir',{writable:false,configurable:false});const home=Object.getOwnPropertyDescriptor(f.os,'homedir');
 expect(()=>installTestAccountHome(f.os,'/isolated-account',()=>{},()=>{})).toThrow();
 expect(Object.getOwnPropertyDescriptor(f.os,'userInfo')).toEqual(f.info);
 expect(Object.getOwnPropertyDescriptor(f.os,'homedir')).toEqual(home);
});
it('rolls back both entries if initial ESM synchronization fails',()=>{
 const f=fixture();let calls=0;
 expect(()=>installTestAccountHome(f.os,'/isolated-account',()=>{},()=>{if(++calls===1)throw Error('sync denied');})).toThrow('sync denied');
 expect(Object.getOwnPropertyDescriptor(f.os,'userInfo')).toEqual(f.info);
 expect(Object.getOwnPropertyDescriptor(f.os,'homedir')).toEqual(f.home);expect(calls).toBe(2);
});
it('keeps both installation and cleanup synchronization failures visible',()=>{
 const f=fixture();let error;
 try{installTestAccountHome(f.os,'/isolated-account',()=>{},()=>{throw Error('sync denied');});}catch(value){error=value;}
 expect(messages(error).filter(value=>value==='sync denied')).toHaveLength(2);
 expect(Object.getOwnPropertyDescriptor(f.os,'userInfo')).toEqual(f.info);
 expect(Object.getOwnPropertyDescriptor(f.os,'homedir')).toEqual(f.home);
});
it('reports a cleanup synchronization failure after restoring both descriptors',()=>{
 const f=fixture();let cleanup=()=>{},calls=0;
 installTestAccountHome(f.os,'/isolated-account',(fn:()=>void)=>{cleanup=fn;},()=>{if(++calls===2)throw Error('cleanup sync denied');});
 let error;try{cleanup();}catch(value){error=value;}
 expect(messages(error)).toContain('cleanup sync denied');
 expect(Object.getOwnPropertyDescriptor(f.os,'userInfo')).toEqual(f.info);
 expect(Object.getOwnPropertyDescriptor(f.os,'homedir')).toEqual(f.home);
});
it('collects both foreign conflicts and attempts one final synchronization',()=>{
 const f=fixture();let cleanup=()=>{},calls=0;
 installTestAccountHome(f.os,'/isolated-account',(fn:()=>void)=>{cleanup=fn;},()=>{calls++;});
 const info=()=>({homedir:'foreign'}),home=()=>'/foreign';f.os.userInfo=info as typeof f.os.userInfo;f.os.homedir=home;
 let error;try{cleanup();}catch(value){error=value;}
 expect(messages(error)).toEqual(['test_profile_account_restoration_conflict:userInfo','test_profile_account_restoration_conflict:homedir']);
 expect(f.os.userInfo).toBe(info);expect(f.os.homedir).toBe(home);expect(calls).toBe(2);
});

it('ignores inherited descriptor get/set poison during ownership check and restore',()=>{
 const f=fixture();let cleanup=()=>{},calls=0;
 installTestAccountHome(f.os,'/isolated-account',(fn:()=>void)=>{cleanup=fn;},()=>{});
 const priorGet=Object.getOwnPropertyDescriptor(Object.prototype,'get'),priorSet=Object.getOwnPropertyDescriptor(Object.prototype,'set');
 try{
  for(const key of ['get','set'])Object.defineProperty(Object.prototype,key,{__proto__:null,configurable:true,get(){calls++;throw Error('inherited descriptor hook');}});
  cleanup();
 }finally{
  for(const [key,prior] of [['get',priorGet],['set',priorSet]] as const){if(prior)Object.defineProperty(Object.prototype,key,{__proto__:null,...prior});else delete (Object.prototype as Record<string,unknown>)[key];}
 }
 expect(calls).toBe(0);
 expect(Object.getOwnPropertyDescriptor(f.os,'userInfo')).toEqual(f.info);
 expect(Object.getOwnPropertyDescriptor(f.os,'homedir')).toEqual(f.home);
});
