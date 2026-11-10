import {randomBytes} from 'node:crypto';
import {types} from 'node:util';
import {assertDefaultDispatchControllerService,readDefaultDispatchControllerBootstrap,type DefaultDispatchControllerBootstrap} from './default-dispatch-business-controller.js';
import {readOriginalDesktopDispatchLaunchState} from './activity-owner-writer-launcher.js';
import type {BusinessScope} from '../../src/runtime/conversation-activity/owned-kswarm-business.js';
const apply=Reflect.apply,get=WeakMap.prototype.get,set=WeakMap.prototype.set,create=Object.create,freeze=Object.freeze,assign=Object.assign,random=randomBytes,isProxy=types.isProxy,isBuffer=Buffer.isBuffer,byteLength=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'length')!.get!;
const denied=()=>Error('DISPATCH_NATIVE_ORIGINAL_BOOTSTRAP_REQUIRED');
interface Record {controller:object;service:object;bootstrap?:DefaultDispatchControllerBootstrap;nonce?:string;used:boolean;checking:boolean;poisoned:boolean;owner?:object;entropyRaw?:unknown}
const capsules=new WeakMap<object,Record>(),controllers=new WeakMap<object,Record>(),grants=new WeakMap<object,Record>();let minting:Record|undefined;
function same(a:BusinessScope,b:BusinessScope){return a.profileId===b.profileId&&a.workspaceId===b.workspaceId;}
function local(row:Record){if(row.poisoned||row.checking||!row.bootstrap)throw denied();row.bootstrap.assertLocal();if(row.poisoned||row.checking)throw denied();}
function current(row:Record){local(row);row.checking=true;try{row.bootstrap!.assertCurrent();}catch(error){row.poisoned=true;throw error;}finally{row.checking=false;}local(row);}
/** Availability only. A distinct Native source/capsule, not a config grant,
 * user frame, recovered A record or authority to attach an existing daemon. */
export function createDesktopDispatchLaunchCapsule(controller:object,service:object):object{
 assertDefaultDispatchControllerService(controller,service);
 if(minting){minting.poisoned=true;throw denied();}if(apply(get,controllers,[controller]))throw denied();
 const row:Record=assign(create(null),{controller,service,bootstrap:undefined,nonce:undefined,used:false,checking:false,poisoned:false,owner:undefined,entropyRaw:undefined});minting=row;
 apply(set,controllers,[controller,row]);
 try{
  row.bootstrap=readDefaultDispatchControllerBootstrap(controller,service);const bytes=random(32);row.entropyRaw=bytes;if(isProxy(bytes)||!isBuffer(bytes)||apply(byteLength,bytes,[])!==32)throw denied();
  const alphabet='0123456789abcdef';let nonce='';for(let i=0;i<32;i++)nonce+=alphabet[bytes[i]!>>>4]!+alphabet[bytes[i]!&15]!;row.nonce=nonce;
  current(row);const capsule=freeze(create(null));apply(set,capsules,[capsule,row]);return capsule;
 }catch(error){row.poisoned=true;throw error;}finally{minting=undefined;}
}
export interface DesktopDispatchLaunch {readonly scope:BusinessScope;readonly mainLaunchNonce:string;assertCurrent():void;assertLocal():void}
/** Consumes exactly once for an original launch-state before its actual spawn.
 * Only the original launcher can create such a state; no caller child argument. */
export function consumeDesktopDispatchLaunchCapsule(capsule:object,owner:object):DesktopDispatchLaunch{
 const row=apply(get,capsules,[capsule]) as Record|undefined;if(!row)throw denied();const state=readOriginalDesktopDispatchLaunchState(owner);
 if(row.used||row.poisoned||row.checking||state.controller!==row.controller||state.service!==row.service||state.child||state.launch||!same(state.scope,row.bootstrap!.scope))throw denied();row.used=true;row.owner=owner;current(row);
 const launch=freeze(assign(create(null),{scope:row.bootstrap!.scope,mainLaunchNonce:row.nonce!,assertCurrent:()=>current(row),assertLocal:()=>local(row)}));apply(set,grants,[launch,row]);return launch;
}
/** Original retained descriptor binding; no business/user command is minted. */
export function assertDesktopDispatchLaunchBinding(launch:object,owner:object):void{
 const row=apply(get,grants,[launch]) as Record|undefined;if(!row||row.owner!==owner||!row.used)throw denied();const state=readOriginalDesktopDispatchLaunchState(owner);
 if(state.controller!==row.controller||state.service!==row.service||state.launch!==launch||!state.child)throw denied();local(row);
}
