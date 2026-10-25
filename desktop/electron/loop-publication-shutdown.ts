import type {DesktopLoopPublicationService} from './loop-desktop-publication-service.js';
import type {DesktopShutdownGate} from './shutdown-aware-ipc-main.js';
import type {IngressOwner,DurableStoreOwner} from './desktop-shutdown-coordinator.js';

export function createLoopPublicationShutdownOwner(service:DesktopLoopPublicationService,gate:DesktopShutdownGate,closeStores:()=>void):{ingress:IngressOwner;durable:DurableStoreOwner}{
 let closed=false;
 return {
  ingress:{name:'loop-publication',stopAccepting:()=>service.stopAccepting(),abortAllActive:()=>service.abortAllActive(),drain:ms=>service.drain(ms)},
  durable:{name:'loop-publication',async close(){
   if(closed)return;
   if(gate.isOpen||gate.outstanding!==0||!await service.drain(0))throw Error('loop_shutdown_not_drained');
   if(closed)return;
   // Recheck after the await; no callback or await before the actual close.
   if(gate.isOpen||gate.outstanding!==0)throw Error('loop_shutdown_not_drained');
   closeStores();closed=true;
  }},
 };
}
