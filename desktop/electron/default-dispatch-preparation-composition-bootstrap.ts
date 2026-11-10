import {readDefaultDispatchPreparationComposition,type DefaultDispatchPreparationOwner,type DefaultDispatchPreparationComposition} from './default-dispatch-preparation-owner.js';
import {readOriginalDesktopPreparationLaunchState} from './activity-owner-writer-launcher.js';
import type {KSwarmService} from './kswarm-service.js';
const get=WeakMap.prototype.get,set=WeakMap.prototype.set,apply=Reflect.apply,create=Object.create,freeze=Object.freeze,assign=Object.assign;
const denied=()=>Error('DEFAULT_DISPATCH_PREPARATION_ORIGINAL_COMPOSITION_REQUIRED');
interface Record {owner:DefaultDispatchPreparationOwner;service:KSwarmService;view:Readonly<DefaultDispatchPreparationComposition>;used:boolean;launchOwner?:object}
const capsules=new WeakMap<object,Record>(),owners=new WeakMap<object,Record>(),launches=new WeakMap<object,Record>();
export interface DesktopPreparationCompositionLaunch extends Pick<DefaultDispatchPreparationComposition,'scope'|'transportSource'|'transportAdmission'> {assertLocal():void}
/** Composition only: no entropy, SDK, Native birth, Work or effect grant. */
export function createDesktopPreparationCompositionCapsule(owner:DefaultDispatchPreparationOwner,service:KSwarmService):object{
 const view=readDefaultDispatchPreparationComposition(owner,service);if(apply(get,owners,[owner]))throw denied();
 const row:Record=assign(create(null),{owner,service,view,used:false,launchOwner:undefined});
 const capsule=freeze(create(null));apply(set,owners,[owner,row]);apply(set,capsules,[capsule,row]);return capsule;
}
/** Only an original, already registered launch state may consume this token.
 * A caller-supplied child, scope or view is never an origin. */
export function consumeDesktopPreparationCompositionCapsule(capsule:unknown,owner:object):Readonly<DesktopPreparationCompositionLaunch>{
 const row=capsule&&typeof capsule==='object'?apply(get,capsules,[capsule]) as Record|undefined:undefined;if(!row)throw denied();
 const state=readOriginalDesktopPreparationLaunchState(owner);
 if(row.used||state.owner!==row.owner||state.service!==row.service||state.child||state.composition||state.scope.profileId!==row.view.scope.profileId||state.scope.workspaceId!==row.view.scope.workspaceId)throw denied();
 row.used=true;row.launchOwner=owner;row.view.assertLocal();
 const launch=freeze(assign(create(null),{scope:row.view.scope,transportSource:row.view.transportSource,transportAdmission:row.view.transportAdmission,assertLocal:row.view.assertLocal}));
 apply(set,launches,[launch,row]);return launch;
}
export function assertDesktopPreparationCompositionBinding(launch:unknown,owner:object):void{
 const row=launch&&typeof launch==='object'?apply(get,launches,[launch]) as Record|undefined:undefined;if(!row||row.launchOwner!==owner||!row.used)throw denied();
 const state=readOriginalDesktopPreparationLaunchState(owner);if(state.owner!==row.owner||state.service!==row.service||state.composition!==launch||!state.child)throw denied();row.view.assertLocal();
}
