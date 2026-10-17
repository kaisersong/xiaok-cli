import type {TimedActionService} from './timed-action-service.js';
import type {DesktopShutdownGate} from './shutdown-aware-ipc-main.js';

/** Main wraps the service before giving it to retained SDK/room tool closures.
 * The original service still performs source and ownership authorization. */
export function createShutdownAwareTimedActionService(service:TimedActionService,gate:DesktopShutdownGate):TimedActionService{
 const methods=new Map<PropertyKey,Function>();
 return new Proxy(service,{
  get(target,key){
   const value=Reflect.get(target,key,target);if(typeof value!=='function'||key==='constructor')return value;
   if(!methods.has(key))methods.set(key,(...args:unknown[])=>{
    const token=gate.acquire('external','timed-service:'+String(key));
    // All TimedActionService methods are synchronous. Keep the original target
    // so internal calls and private fields retain their normal semantics.
    try{return Reflect.apply(value,target,args);}finally{token.release();}
   });
   return methods.get(key);
  },
 });
}
