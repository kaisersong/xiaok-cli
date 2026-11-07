import { afterEach, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, statSync, rmSync, rmdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConversationActivityOwnerHost } from '../../../src/runtime/conversation-activity/owner-host.js';
import { activityOwnerAddress } from '../../../src/runtime/conversation-activity/owner-protocol.js';
import { ConversationActivityOwnerClient } from '../../../src/runtime/conversation-activity/owner-client.js';
import { createNativeSourceCredential, nativeSourceCredentialPath, readNativeSourceCredential } from '../../../src/runtime/conversation-activity/native-source-credentials.js';
const cleanups:Array<()=>void|Promise<void>>=[];afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
async function setup(supported=true){
 const root=mkdtempSync(join(tmpdir(),'native-source-socket-'));cleanups.push(()=>rmSync(root,{recursive:true,force:true}));
 const host=new ConversationActivityOwnerHost({dataRoot:root,profileId:'profile',actorId:'user',nativeSourceSupported:supported,getThread:()=>null,canObserveWork:()=>false,authorizeProducer:()=>false});
 await host.start();cleanups.push(async()=>{await host.stop();if(process.platform!=='win32')rmdirSync(dirname(host.address.socketPath));});
 const producer=new ConversationActivityOwnerClient(root,'producer'),user=new ConversationActivityOwnerClient(root,'user');cleanups.push(()=>producer.dispose(),()=>user.dispose());
 return{root,host,producer,user};
}
it.skipIf(process.platform==='win32')('authenticates only the actual producer socket with the independent host capability',async()=>{
 const f=await setup();const original=readFileSync(f.host.address.credentialsPath);const credential=readNativeSourceCredential(f.host.address);
 expect(await f.producer.request('status')).toMatchObject({nativeSourceProtocol:1});
 const params={nativeSourceProtocol:1,ownerEpoch:f.host.ownerEpoch,token:credential.token};
 await expect(f.user.request('authorizeNativeSource',params)).rejects.toThrow('activity_method_forbidden');
 for(const invalid of [{...params,token:'0'.repeat(64)},{...params,ownerEpoch:'foreign'},{...params,nativeSource:true},{...params,token:undefined},{...params,nativeSourceProtocol:2}]){
  await expect(f.producer.request('authorizeNativeSource',invalid)).rejects.toThrow('activity_native_source_forbidden');
 }
 expect(await f.producer.request('authorizeNativeSource',params)).toEqual({nativeSourceProtocol:1,ownerEpoch:f.host.ownerEpoch});
 expect(await f.producer.request('authorizeNativeSource',params)).toEqual({nativeSourceProtocol:1,ownerEpoch:f.host.ownerEpoch});
 expect(readFileSync(f.host.address.credentialsPath)).toEqual(original);
 const status=await f.user.request('status');expect(JSON.stringify(status)).not.toContain(credential.token);
});
it('keeps ordinary activity usable when the actual owner does not support Native sources',async()=>{
 const f=await setup(false);const status=await f.producer.request<any>('status');expect(Object.hasOwn(status,'nativeSourceProtocol')).toBe(false);
 await expect(f.producer.request('authorizeNativeSource',{nativeSourceProtocol:1,ownerEpoch:f.host.ownerEpoch,token:'0'.repeat(64)})).rejects.toThrow('activity_native_source_unsupported');
 expect(await f.user.request('status')).toMatchObject({profileId:'profile',ownerEpoch:f.host.ownerEpoch});
});

it.skipIf(process.platform==='win32')('binds Native responses to the exact original socket and keeps ordinary producers outside the capability',async()=>{
 const f=await setup();const other=new ConversationActivityOwnerClient(f.root,'producer');cleanups.push(()=>other.dispose());
 const [one,two]=await Promise.all([f.producer.requestNative<any>('status'),f.producer.requestNative<any>('status')]);
 expect(one.value.nativeSourceProtocol).toBe(1);f.producer.assertNativeConnectionCurrent(one.connection);f.producer.assertNativeConnectionCurrent(two.connection);
 expect(()=>other.assertNativeConnectionCurrent(one.connection)).toThrow(/native_source/);expect(()=>f.producer.assertNativeConnectionCurrent(structuredClone(one.connection))).toThrow(/native_source/);
 await expect(f.user.requestNative('status')).rejects.toThrow(/native_source_forbidden/);
});
it.skipIf(process.platform==='win32')('never sends the business request on a replacement socket after an in-flight auth response is lost',async()=>{
 const f=await setup();const original=(f.host as any).dispatch.bind(f.host);let release!:()=>void,entered!:()=>void;let auth=0,business=0;
 const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r);
 vi.spyOn(f.host as any,'dispatch').mockImplementation(async(client:any,method:any,params:any)=>{
  const result=await original(client,method,params);if(method==='unread')business++;
  if(method==='authorizeNativeSource'&&++auth===1){entered();await gate;}return result;
 });
 try{
  const old=f.producer.requestNative('unread');const observed=Promise.allSettled([old]);await ready;
  (f.producer as any).socket.destroy();expect((await observed)[0].status).toBe('rejected');
  expect(await f.producer.request('status')).toMatchObject({ownerEpoch:f.host.ownerEpoch});release();expect(business).toBe(0);
  const current=await f.producer.requestNative<any>('unread');expect(current.value).toEqual([]);expect(auth).toBe(2);expect(business).toBe(1);
  f.producer.assertNativeConnectionCurrent(current.connection);(f.producer as any).socket.destroy();expect(()=>f.producer.assertNativeConnectionCurrent(current.connection)).toThrow(/native_source/);
 }finally{release();}
});

it.skipIf(process.platform==='win32')('never repairs an exposed Native secret into a valid capability through the actual address and host entrypoints',async()=>{
 const root=mkdtempSync(join(tmpdir(),'native-exposed-capability-'));cleanups.push(()=>rmSync(root,{recursive:true,force:true}));const address=activityOwnerAddress(root);
 const credential=createNativeSourceCredential(address);const path=nativeSourceCredentialPath(address);chmodSync(path,0o644);const failures:unknown[]=[];
 const host=new ConversationActivityOwnerHost({dataRoot:root,profileId:'profile',actorId:'user',nativeSourceSupported:true,getThread:()=>null,canObserveWork:()=>false,authorizeProducer:()=>false,onError:error=>{failures.push(error);}});
 await host.start();cleanups.push(async()=>{await host.stop();rmdirSync(dirname(host.address.socketPath));});const producer=new ConversationActivityOwnerClient(root,'producer');cleanups.push(()=>producer.dispose());
 expect(statSync(path).mode&0o777).toBe(0o644);expect(readFileSync(path,'utf8')).toContain(credential.token);
 expect(await producer.request('status')).not.toHaveProperty('nativeSourceProtocol');expect(failures).toHaveLength(1);
 await expect(producer.requestNative('status')).rejects.toThrow('activity_native_source_unsupported');expect(await producer.request('status')).toMatchObject({profileId:'profile'});
});

it.skipIf(process.platform==='win32')('fences an observed runtime credential exposure without restoring the old capability after chmod',async()=>{
 const f=await setup();const credential=readNativeSourceCredential(f.host.address);const params={nativeSourceProtocol:1,ownerEpoch:f.host.ownerEpoch,token:credential.token};
 expect(await f.producer.request('authorizeNativeSource',params)).toMatchObject({nativeSourceProtocol:1});chmodSync(nativeSourceCredentialPath(f.host.address),0o644);
 await expect(f.producer.request('authorizeNativeSource',params)).rejects.toThrow('activity_native_source_unsupported');
 chmodSync(nativeSourceCredentialPath(f.host.address),0o600);
 expect(await f.producer.request('status')).not.toHaveProperty('nativeSourceProtocol');await expect(f.producer.request('authorizeNativeSource',params)).rejects.toThrow('activity_native_source_unsupported');
 expect(await f.user.request('status')).toMatchObject({profileId:'profile'});
});

it.skipIf(process.platform==='win32')('rejects an authenticated old connection immediately before business send, even after same-owner reconnect',async()=>{
 const f=await setup();const original=f.producer.authorizeNativeSource.bind(f.producer);const dispatch=(f.host as any).dispatch.bind(f.host);let business=0;
 vi.spyOn(f.host as any,'dispatch').mockImplementation((client:any,method:any,params:any)=>{if(method==='unread')business++;return dispatch(client,method,params);});
 const authorization=vi.spyOn(f.producer,'authorizeNativeSource').mockImplementation(async()=>{
  const frame=await original();const socket=(f.producer as any).socket;socket.destroy();await vi.waitFor(()=>expect((f.producer as any).socket).toBeUndefined());await f.producer.request('status');expect((f.producer as any).socket).not.toBe(socket);return frame;
 });
 await expect(f.producer.requestNative('unread')).rejects.toThrow('activity_native_source_connection_stale');expect(business).toBe(0);
 authorization.mockRestore();expect((await f.producer.requestNative<any>('unread')).value).toEqual([]);expect(business).toBe(1);
});
it.skipIf(process.platform==='win32')('owns the admitted auth callback through original host seal and never sends its business operation',async()=>{
 const f=await setup();const dispatch=(f.host as any).dispatch.bind(f.host);let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r);let business=0;
 vi.spyOn(f.host as any,'dispatch').mockImplementation(async(client:any,method:any,params:any)=>{const result=await dispatch(client,method,params);if(method==='unread')business++;if(method==='authorizeNativeSource'){entered();await gate;}return result;});
 try{
  const request=f.producer.requestNative('unread'),observed=Promise.allSettled([request]);await ready;let drained=false;
  const closing=f.host.sealAndDrain().then(()=>{drained=true;});await new Promise(r=>setTimeout(r,15));expect(drained).toBe(false);expect(f.host.store.listWatches()).toEqual([]);
  expect((await observed)[0].status).toBe('rejected');expect(business).toBe(0);release();await closing;expect(drained).toBe(true);expect(business).toBe(0);
 }finally{release();}
});
it.skipIf(process.platform==='win32')('rechecks each caller after shared auth and sends only the still-admitted caller business request',async()=>{
 const f=await setup(),original=(f.host as any).dispatch.bind(f.host);let release!:()=>void,enter!:()=>void,allowed=true,business=0;const gate=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>enter=r),primary=Error('native_caller_revoked');
 vi.spyOn(f.host as any,'dispatch').mockImplementation(async(client:any,method:any,params:any)=>{const result=await original(client,method,params);if(method==='authorizeNativeSource'){enter();await gate;}if(method==='unread')business++;return result;});
 const first=f.producer.requestNative('unread',{},()=>{if(!allowed)throw primary;}),observed=Promise.allSettled([first]);await entered;const second=f.producer.requestNative<any>('unread',{},()=>{});allowed=false;release();
 const result=await observed;expect(result[0].status).toBe('rejected');if(result[0].status!=='rejected')throw Error('expected_native_guard_rejection');expect(result[0].reason).toBe(primary);expect((await second).value).toEqual([]);expect(business).toBe(1);
});
it.skipIf(process.platform==='win32')('checks the actual write frame after serialization and never sends when the original caller is withdrawn there',async()=>{
 const f=await setup(),original=(f.host as any).dispatch.bind(f.host);let allowed=true,business=0;vi.spyOn(f.host as any,'dispatch').mockImplementation((client:any,method:any,params:any)=>{if(method==='unread')business++;return original(client,method,params);});
 const params={toJSON(){allowed=false;return{};}};await expect(f.producer.requestNative('unread',params,()=>{if(!allowed)throw Error('native_caller_revoked');})).rejects.toThrow('native_caller_revoked');expect(business).toBe(0);
});
it.skipIf(process.platform==='win32')('rejects asynchronous or falsy guards and a guard that destroys its original connection before send',async()=>{
 const f=await setup(),original=(f.host as any).dispatch.bind(f.host);let business=0;vi.spyOn(f.host as any,'dispatch').mockImplementation((client:any,method:any,params:any)=>{if(method==='unread')business++;return original(client,method,params);});
 for(const guard of [async()=>{},()=>false])await expect(f.producer.requestNative('unread',{},guard as ()=>void)).rejects.toThrow('before_effects_guard_invalid');
 let checks=0;await expect(f.producer.requestNative('unread',{},()=>{if(++checks===2)(f.producer as any).socket.destroy();})).rejects.toThrow(/native_source_connection_stale/);expect(business).toBe(0);
});
it.skipIf(process.platform==='win32')('does not replay an already-dispatched request if its original response is withheld and the caller then loses admission',async()=>{
 const f=await setup(),original=(f.host as any).dispatch.bind(f.host);let release!:()=>void,enter!:()=>void,allowed=true,business=0;const gate=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>enter=r),primary=Error('native_caller_revoked_after_dispatch');
 vi.spyOn(f.host as any,'dispatch').mockImplementation(async(client:any,method:any,params:any)=>{const result=await original(client,method,params);if(method==='unread'){business++;enter();await gate;}return result;});
 const pending=f.producer.requestNative('unread',{},()=>{if(!allowed)throw primary;}),observed=Promise.allSettled([pending]);await entered;allowed=false;release();const result=await observed;expect(result[0].status).toBe('rejected');if(result[0].status!=='rejected')throw Error('expected_native_guard_rejection');expect(result[0].reason).toBe(primary);expect(business).toBe(1);
});
