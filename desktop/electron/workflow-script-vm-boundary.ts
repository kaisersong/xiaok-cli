import vm from 'node:vm';
import {types} from 'node:util';
import {captureDispatchBusinessData} from '../../src/runtime/conversation-activity/dispatch-business-data.js';
const apply=Reflect.apply,construct=Reflect.construct,descriptor=Object.getOwnPropertyDescriptor,keys=Reflect.ownKeys,own=Object.hasOwn,prototype=Object.getPrototypeOf,freeze=Object.freeze,setPrototype=Object.setPrototypeOf;
const NativePromise=Promise,then=Promise.prototype.then,isPromise=types.isPromise,isProxy=types.isProxy,isArray=Array.isArray,create=Object.create,define=Object.defineProperty;
const weakGet=WeakMap.prototype.get,weakSet=WeakMap.prototype.set,weakHas=WeakMap.prototype.has,NativeWeakMap=WeakMap,NativeError=Error,NativeSet=Set,setHas=Set.prototype.has,setAdd=Set.prototype.add,setDelete=Set.prototype.delete,json=JSON.stringify,integer=Number.isSafeInteger,number=Number,exec=RegExp.prototype.exec;
const functionSource=Function.prototype.toString,originalFunctions=new NativeWeakMap<object,string>();
/** Original thunk text is used only by existing label/token estimates. */
export function workflowScriptThunkSource(fn:Function):string{return (apply(weakGet,originalFunctions,[fn]) as string|undefined)??apply(functionSource,fn,[]) as string;}
/** Data/call boundary only. The Worker and original Main controller still own
 * CPU, physical termination and effect authorization respectively. */
export function createWorkflowScriptVmBoundary(bindings:Record<string,unknown>,name:string){
 const context=vm.createContext(vm.constants.DONT_CONTEXTIFY, {name,codeGeneration:{strings:false,wasm:false}});
 // A contextified Host sandbox object exposes its Host Object constructor via
 // `this.constructor`. This global is VM-owned and has no inherited global
 // constructor at all; the minimum Node runtime must support this mode.
 vm.runInContext('Object.setPrototypeOf(globalThis,null)',context);
 // Worker resourceLimits cover the V8 heap, not unbounded external buffers.
 // The orchestration DSL exchanges JSON only; expose no binary/Wasm allocator.
 vm.runInContext("for(const key of ['ArrayBuffer','SharedArrayBuffer','DataView','Int8Array','Uint8Array','Uint8ClampedArray','Int16Array','Uint16Array','Int32Array','Uint32Array','Float32Array','Float64Array','BigInt64Array','BigUint64Array','WebAssembly','Atomics','Intl','WeakRef','FinalizationRegistry'])Object.defineProperty(globalThis,key,{value:undefined,writable:false,configurable:false});",context);
 const intrinsics=vm.runInContext('({ObjectPrototype:Object.prototype,ArrayPrototype:Array.prototype,Promise,then:Promise.prototype.then,parse:JSON.parse,Error})',context) as {ObjectPrototype:object;ArrayPrototype:object;Promise:PromiseConstructor;then:Function;parse:Function;Error:ErrorConstructor};
 const errors=new NativeWeakMap<object,unknown>();
 const harden=<T extends Function>(fn:T):T=>{setPrototype(fn,null);return freeze(fn);};
 const bad=()=>new NativeError('workflow_script_vm_boundary_invalid');
 function toVm(value:unknown):unknown{
  if(value===undefined)return undefined;
  // Host results are data. This parser returns only VM realm objects; no Host
  // Promise, Error, Array or callback is delivered to script code.
  let captured:unknown;try{captured=captureDispatchBusinessData(value,()=>{},true);}catch(error){throw new NativeError('workflow_script_host_result_invalid',{cause:value});}const encoded=json(captured);if(encoded===undefined)throw bad();return apply(intrinsics.parse,undefined,[encoded]);
 }
 function vmError(error:unknown):object{const value=construct(intrinsics.Error,['workflow_script_host_operation_failed']) as object;apply(weakSet,errors,[value,error]);return value;}
 function hostError(error:unknown):unknown{return error&&typeof error==='object'&&apply(weakHas,errors,[error])?apply(weakGet,errors,[error]):error;}
 function fromVm(value:unknown,depth=0,active=new NativeSet<object>()):unknown{
  if(value===null||value===undefined||typeof value==='string'||typeof value==='boolean'||typeof value==='number')return value;
  if(depth>128||isProxy(value))throw bad();
  if(typeof value==='function'){const wrapped=harden((...args:unknown[])=>{let raw:unknown;try{raw=apply(value,undefined,argumentsToVm(args));}catch(error){return NativePromise.reject(hostError(error));}return observe(raw);});apply(weakSet,originalFunctions,[wrapped,apply(functionSource,value,[])]);return wrapped;}
  if(typeof value!=='object'||apply(setHas,active,[value]))throw bad();
  const array=isArray(value),proto=prototype(value);if(proto!==(array?intrinsics.ArrayPrototype:intrinsics.ObjectPrototype)&&proto!==null)throw bad();
  apply(setAdd,active,[value]);const output=array?[]:create(null),names=keys(value);let length=0;
  if(array){const row=descriptor(value,'length');if(!row||!own(row,'value')||!integer(row.value)||row.value<0||row.value>65536)throw bad();length=row.value;}
  for(let i=0;i<names.length;i++){const key=names[i]!;if(typeof key!=='string')throw bad();const row=descriptor(value,key);if(!row||!own(row,'value'))throw bad();if(array&&key==='length')continue;if(key==='then')throw bad();if(array&&(apply(exec,/^(0|[1-9][0-9]*)$/,[key])===null||number(key)>=length))throw bad();define(output,key,{__proto__:null,value:fromVm(row.value,depth+1,active),enumerable:true,writable:true,configurable:true} as PropertyDescriptor);}
  if(array&&names.length!==length+1)throw bad();apply(setDelete,active,[value]);return output;
 }
 function argumentsToVm(args:unknown[]):unknown[]{const out:unknown[]=[];for(let i=0;i<args.length;i++)define(out,i,{__proto__:null,value:toVm(args[i]),enumerable:true,writable:true,configurable:true} as PropertyDescriptor);return out;}
 function argumentsFromVm(args:unknown[]):unknown[]{const out:unknown[]=[];for(let i=0;i<args.length;i++)define(out,i,{__proto__:null,value:fromVm(args[i]),enumerable:true,writable:true,configurable:true} as PropertyDescriptor);return out;}
 function observe(raw:unknown):Promise<unknown>{
  if(!raw||!isPromise(raw)||isProxy(raw)){try{return NativePromise.resolve(fromVm(raw));}catch(error){return NativePromise.reject(hostError(error));}}
  return new NativePromise((yes,no)=>{const fulfilled=harden((value:unknown)=>{try{yes(fromVm(value));}catch(error){no(hostError(error));}}),rejected=harden((error:unknown)=>no(hostError(error)));try{apply(intrinsics.then,raw,[fulfilled,rejected]);}catch(error){no(hostError(error));}});
 }
 function wrap(fn:Function):Function{return harden((...args:unknown[])=>{
  let raw:unknown;try{raw=apply(fn,undefined,argumentsFromVm(args));}catch(error){throw vmError(error);}
  if(!isPromise(raw)||isProxy(raw)){try{return toVm(raw);}catch(error){throw vmError(error);}}
  // Construct with the captured VM Promise, not a Host thenable. Its resolving
  // functions and every value subsequently visible to script belong to VM.
  let resolve!:Function,reject!:Function;const executor=harden((yes:Function,no:Function)=>{resolve=yes;reject=no;}),result=construct(intrinsics.Promise,[executor]);
  const fulfilled=harden((value:unknown)=>{try{apply(resolve,undefined,[toVm(value)]);}catch(error){apply(reject,undefined,[vmError(error)]);}}),rejected=harden((error:unknown)=>{apply(reject,undefined,[vmError(error)]);});
  try{apply(then,raw,[fulfilled,rejected]);}catch(error){apply(reject,undefined,[vmError(error)]);}return result;
 });}
 const names=keys(bindings);for(let i=0;i<names.length;i++){const key=names[i]!;if(typeof key!=='string')throw bad();const row=descriptor(bindings,key);if(!row||!own(row,'value'))throw bad();let value:unknown;if(typeof row.value==='function')value=wrap(row.value);else{const object=create(null),nested=keys(row.value);for(let j=0;j<nested.length;j++){const name=nested[j]!,member=descriptor(row.value,name);if(!member||!own(member,'value')||typeof member.value!=='function')throw bad();define(object,name,{__proto__:null,value:wrap(member.value),enumerable:true} as PropertyDescriptor);}value=freeze(object);}define(context,key,{__proto__:null,value,enumerable:true} as PropertyDescriptor);}
 return freeze({context,observe});
}
