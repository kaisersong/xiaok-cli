// @vitest-environment node
// POSTAPPLY ONLY: real new transport negative seams, NOT a fake SDK/producer qualification.
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('electron',()=>({app:{getPath:()=>'/tmp/query-register',getLocale:()=> 'en'},BrowserWindow:{getAllWindows:()=>[]},clipboard:{},dialog:{},shell:{}}));
import { queryFixture, actualQueryParser } from '../support/goal-native-query-fixture.js';
import { registerGoalNativeQueryIpc } from '../../electron/goal-native-query-typed-ipc.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import type { GoalNativeQueryDto } from '../../shared/goal-native-query-ipc-contract.js';
const NativePromise=Promise;
const owned:Array<Awaited<ReturnType<typeof queryFixture>>>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const f of owned.splice(0))await f.close();});
async function negativeSeam(read:(threadId:string)=>Promise<GoalNativeQueryDto|null>){
 resetIpcSchemaRegistryForTests();const f=await queryFixture();owned.push(f);
 const gate=new DesktopShutdownGate(),listeners=new Map<string,IpcHandlerListener>();
 const registrar=new ShutdownAwareIpcMain({handle:(channel,listener)=>listeners.set(channel,listener)},gate,f.authority.coarse);
 registerGoalNativeQueryIpc(registrar,read,actualQueryParser(),event=>{if(!f.authority.finer(event)||event.sender.isDestroyed())throw Error('goal_native_query_sender_forbidden');});
 const invoke=()=>Reflect.apply(listeners.get('desktop:goal:getNativeMutation')!,undefined,[f.event,{threadId:'thread'}]) as Promise<unknown>;
 return {invoke,gate};
}
const row:GoalNativeQueryDto={id:'negative-control',kind:'create',status:'reserved',objective:'Scripted boundary data'};
it.each(['privateDTO','accessor','proxy'] as const)('new transport rejects %s data without leaking private fields/getter/traps',async mode=>{
 let reads=0;let value:unknown;
 if(mode==='privateDTO')value={...row,authority:{secret:'must-not-cross'},control:'must-not-cross'};
 else if(mode==='accessor')value=Object.defineProperty({...row},'objective',{enumerable:true,get(){reads++;throw Error('forbidden_DTO_getter');}});
 else value=new Proxy({...row},{ownKeys(){reads++;throw Error('forbidden_DTO_proxy');}});
 const f=await negativeSeam(()=>NativePromise.resolve(value as GoalNativeQueryDto));
 await expect(f.invoke()).rejects.toThrow('goal_native_query_projection_unavailable');expect(reads).toBe(0);expect(f.gate.outstanding).toBe(0);
});
it('rejects an already-invalid fulfilled raw Promise own-constructor descriptor without invoking it',async()=>{
 let reads=0;const raw=NativePromise.resolve(row);
 Object.defineProperty(raw,'constructor',{configurable:true,get(){reads++;throw Error('raw_constructor_getter');}});
 const f=await negativeSeam(()=>raw);await expect(f.invoke()).rejects.toThrow('goal_native_query_projection_unavailable');expect(reads).toBe(0);expect(f.gate.outstanding).toBe(0);
 // Fulfilled negative seam: not evidence arbitrary hostile rejected producers can be abandoned safely.
});
it('owns an accepted standard raw Promise rejection even after asynchronous own-constructor poisoning, with no orphan',async()=>{
 let reject!: (error:Error)=>void,reads=0;
 const raw=new NativePromise<GoalNativeQueryDto|null>((_resolve,fail)=>{reject=fail;});
 const f=await negativeSeam(()=>raw),failure=Error('ordinary_read_failure');const unhandled:unknown[]=[];
 const observer=(reason:unknown)=>{unhandled.push(reason);};process.on('unhandledRejection',observer);
 try{
  const pending=f.invoke(); // Standard raw validated and intrinsic reaction installed synchronously.
  const observed=expect(pending).rejects.toBe(failure);
  queueMicrotask(()=>{Object.defineProperty(raw,'constructor',{configurable:true,get(){reads++;throw Error('late_raw_constructor_getter');}});reject(failure);});
  await observed;await new NativePromise<void>(resolve=>setImmediate(resolve));
  expect(reads).toBe(0);expect(unhandled).toEqual([]);expect(f.gate.outstanding).toBe(0);
 }finally{process.off('unhandledRejection',observer);}
 // Ordinary seam only: no SDK/profile/native factory, no fake authority or native release proof.
});
