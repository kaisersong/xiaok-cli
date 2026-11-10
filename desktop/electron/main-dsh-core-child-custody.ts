/** Internal negative child receipts only; no original Main membership is made here.
 * Main keeps its maps, issuer and fixed positive SDK calls in its private closure. */
import {createRoomTurnCustody} from './original-room-turn-custody.js';
import {createOriginalMainDshKSwarmCleanup,combineOriginalMainDshCoreCloseError} from './main-dsh-core-kswarm-cleanup.js';
import {createOriginalMainDshBrokerCleanup} from './main-dsh-core-broker-cleanup.js';
import type {createOriginalMainDshChildFunctionCustody} from './main-dsh-core-child-functions.js';
import type {MainDshCoreCloseFailure} from './main-dsh-bootstrap-types.js';
import {types} from 'node:util';
const descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn;
export interface OriginalMainDshCoreChild {
 stock:ReturnType<typeof createRoomTurnCustody>;cleanup:ReturnType<typeof createRoomTurnCustody>;
 sources:ReturnType<typeof createOriginalMainDshKSwarmCleanup>;functions?:ReturnType<typeof createOriginalMainDshChildFunctionCustody>;
 opening?:Promise<object>;port?:object;entered:boolean;assert?:Function;terminal?:Function;failure?:{raw:unknown};
}
function child(sources:OriginalMainDshCoreChild['sources']):OriginalMainDshCoreChild{return {stock:createRoomTurnCustody(),cleanup:createRoomTurnCustody(),sources,entered:false};}
export function createOriginalMainDshKSwarmCoreChild():OriginalMainDshCoreChild{return child(createOriginalMainDshKSwarmCleanup());}
export function createOriginalMainDshBrokerCoreChild():OriginalMainDshCoreChild{return child(createOriginalMainDshBrokerCleanup());}
function denied():never{throw Error('DSH_MAIN_CHILD_CLEANUP_UNCONFIRMED');}
function cancel(port:object):Function{const d=descriptor(port,'cancel');if(!d||!own(d,'value')||typeof d.value!=='function'||types.isProxy(d.value))denied();return d.value;}
/** The original Main passes only its own closed row. Counterfeit rows here cannot
 * be inserted into Main's private lease map or make its readers accept a lease. */
export async function closeOriginalMainDshCoreChild(row:OriginalMainDshCoreChild,api:object):Promise<MainDshCoreCloseFailure|undefined>{
 if(row.opening)try{await row.opening;}catch{/* Original prepare retains its first cause. */}
 if(row.entered&&!row.port)throw row.failure?row.failure.raw:Error('DSH_MAIN_CHILD_HANDLE_UNCONFIRMED');
 if(!row.port){await row.stock.waitPhysicalKnown();if(row.functions)await row.functions.join();return;}
 let failed:{raw:unknown}|undefined;
 try{const identity=await row.cleanup.sdk(row.assert!,api,[row.port]);if(identity!==undefined)denied();}catch(raw){failed={raw};}
 let cut:Awaited<ReturnType<OriginalMainDshCoreChild['sources']['close']>>|undefined;
 try{cut=await row.sources.close(row.port);}catch(raw){failed??={raw};}
 const first=cut?.first;
 if(cut&&!cut.sourceEntered)try{const raw=await row.cleanup.sdk(cancel(row.port),row.port,[]);if(raw!==undefined)throw Error('DSH_MAIN_CHILD_CANCEL_NONVOID',{cause:raw});}catch(raw){failed??={raw};}
 try{const raw=await row.stock.consumeResource(row.terminal!,row.port,[row.port]);if(raw!==undefined)denied();}catch(raw){failed??={raw};}
 const stocks=[row.stock,row.cleanup];
 for(let i=0;i<stocks.length;i++)try{await stocks[i]!.waitPhysicalKnown();}catch(raw){failed??={raw};}
 if(row.functions)try{await row.functions.join();}catch(raw){failed??={raw};}
 if(failed){if(first)throw combineOriginalMainDshCoreCloseError(first,failed);throw failed.raw;}
 if(cut?.unconfirmed)throw combineOriginalMainDshCoreCloseError(first??cut.unconfirmed);
 return first;
}
