import type {DesktopShutdownGate} from './shutdown-aware-ipc-main.js';

/** Register before the first window/store callback, and retain across every
 * startup await. A shutdown deadline cannot make unfinished startup quiescent. */
export async function withDesktopBootstrapWriter<T>(gate:DesktopShutdownGate,createResources:()=>Promise<T>):Promise<T>{
 const writer=gate.acquire('bootstrap_queue','initial-window');
 try{return await createResources();}finally{writer.release();}
}
