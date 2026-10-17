// UNREVIEWED POST-APPLICATION controls: copy to desktop/tests/main/meeting-actions10-native-boundary.test.ts.
// Imports candidate at its production target. Missing module before application
// is NOT a behavior RED. Producer adapters test the real registrar boundary.
// @vitest-environment node
import { beforeEach, expect, it } from 'vitest';
import { registerMeetingActions10Ipc } from '../../electron/meeting-actions10-typed-ipc.js';
import { MEETING_ACTIONS10_METHODS } from '../../shared/meeting-actions10-ipc-contract.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { DesktopShutdownGate,ShutdownAwareIpcMain,type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
beforeEach(resetIpcSchemaRegistryForTests);
function fixture(method:string,producer:IpcHandlerListener){const gate=new DesktopShutdownGate(),listeners=new Map<string,IpcHandlerListener>(),ipc=new ShutdownAwareIpcMain({handle:(c,l)=>listeners.set(c,l)},gate),bindings=new Map([['desktop:meeting:'+method,producer]]);registerMeetingActions10Ipc(ipc,bindings);return {gate,ipc,bindings,invoke:()=>listeners.get('desktop:meeting:'+method)!({}as never,...(method==='pickAudioFile'?[]:[{}]))};}
const promiseCases=['thenable','subclass','proxy','constructor-getter','constructor-value','species-getter','own-then-getter']as const;
it.each(MEETING_ACTIONS10_METHODS.flatMap(method=>promiseCases.map(kind=>[method,kind]as const)))('real registrar %s native Promise case %s',async(method,kind)=>{
 let reads=0;let result:unknown;const species=Object.getOwnPropertyDescriptor(Promise,Symbol.species)!;
 const value=method==='pickAudioFile'?null:method==='saveRecordedAudio'||method==='transcribePreview'?{ok:false,error:'invalid_wav'}:method==='saveTranscript'?{ok:false,error:'transcript_required'}:method.startsWith('live:')?{ok:false,error:'meeting_live_session_not_found'}:{ok:false,error:'transcriber_unavailable'};
 if(kind==='thenable')result=Object.defineProperty({},'then',{enumerable:true,get(){reads++;return ()=>{};}});
 else if(kind==='subclass'){class Child extends Promise<unknown>{};result=Child.resolve(value);}
 else if(kind==='proxy')result=new Proxy(Promise.resolve(value),{});
 else {result=Promise.resolve(value);if(kind==='constructor-getter')Object.defineProperty(result,'constructor',{get(){reads++;return Promise;}});if(kind==='constructor-value')Object.defineProperty(result,'constructor',{value:{}});if(kind==='species-getter')Object.defineProperty(Promise,Symbol.species,{configurable:true,get(){reads++;return Promise;}});if(kind==='own-then-getter')Object.defineProperty(result,'then',{get(){reads++;return ()=>{};}});}
 try {const f=fixture(method,()=>result),operation=f.invoke();if(kind==='species-getter')Object.defineProperty(Promise,Symbol.species,species);if(kind==='own-then-getter')expect(await operation).toEqual(value);else await expect(operation).rejects.toThrow('meeting_actions10_projection_unavailable');expect(reads).toBe(0);expect(f.gate.outstanding).toBe(0);}finally{Object.defineProperty(Promise,Symbol.species,species);}
});
it.each(MEETING_ACTIONS10_METHODS)('real %s token releases only after physical producer settlement',async method=>{
 let resolve!:(value:unknown)=>void;const f=fixture(method,()=>new Promise(r=>{resolve=r;}));const operation=Promise.resolve(f.invoke()).catch(error=>error);expect(f.gate.outstanding).toBe(1);f.gate.close();const drain=f.gate.drain(1000);resolve(undefined);const failure=await operation;expect(failure).toBeInstanceOf(Error);expect((failure as Error).message).toBe('meeting_actions10_projection_unavailable');expect(await drain).toBe(true);expect(f.gate.outstanding).toBe(0);
});
it.each(MEETING_ACTIONS10_METHODS)('real %s rejects void/invalid successful ACK and malformed false envelopes',async method=>{
 for(const value of [undefined,{ok:true,extra:true},{ok:false},{ok:false,error:'invalid_wav',extra:'owned-private-marker'}]){resetIpcSchemaRegistryForTests();const f=fixture(method,()=>value);await expect(f.invoke()).rejects.toThrow('meeting_actions10_projection_unavailable');}
});
it.each(MEETING_ACTIONS10_METHODS)('real %s captures output without reading accessors',async method=>{let getters=0;const value=Object.defineProperty({},'ok',{enumerable:true,get(){getters++;return true;}});const f=fixture(method,()=>value);await expect(f.invoke()).rejects.toThrow('meeting_actions10_projection_unavailable');expect(getters).toBe(0);});
it('binding ownership/detachment and original producer rejection identity are preserved',async()=>{const error=Error('meeting_live_failed'),f=fixture('pickAudioFile',()=>Promise.reject(error));await expect(f.invoke()).rejects.toBe(error);f.bindings.set('desktop:meeting:pickAudioFile',()=>null);await expect(f.invoke()).rejects.toBe(error);registerMeetingActions10Ipc(f.ipc,f.bindings);expect(()=>registerMeetingActions10Ipc(f.ipc,new Map(f.bindings))).toThrow('meeting_actions10_registrar_owner_conflict');});

it('actual error boundary never evaluates a hostile error message accessor',async()=>{let reads=0;const error=Object.defineProperty(Error('owned'),'message',{get(){reads++;return 'owned-private-credential-marker';}}),f=fixture('pickAudioFile',()=>Promise.reject(error));await expect(f.invoke()).rejects.toThrow('meeting_actions10_operation_failed');expect(reads).toBe(0);});
it('actual error boundary preserves reject semantics but replaces unknown private native text',async()=>{const f=fixture('pickAudioFile',()=>Promise.reject(Error('owned-private-credential-marker')));const error=await Promise.resolve(f.invoke()).catch(error=>error);expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe('meeting_actions10_operation_failed');expect(String(error)).not.toContain('owned-private-credential-marker');});
