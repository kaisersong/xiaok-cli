import {createDefaultDispatchPreparationNativeSource} from './default-dispatch-preparation-native-source.js';
import {createDefaultDispatchPreparationOwner} from './default-dispatch-preparation-owner.js';
import {createDefaultDispatchBusinessController} from './default-dispatch-business-controller.js';
import {createKSwarmWriterControlSource} from './kswarm-writer-control-source.js';
import type {DesktopMainIdentity} from './desktop-main-identity.js';
import type {IngressOwner} from './desktop-shutdown-coordinator.js';

type WriterOptions=Parameters<typeof createKSwarmWriterControlSource>[0];
type Options=WriterOptions&{identity:Pick<DesktopMainIdentity,'scope'>;window:Parameters<typeof createDefaultDispatchPreparationNativeSource>[0]['window'];registerIngress(owner:IngressOwner):void;registerFinalStep(step:{name:string;run():Promise<void>}):void};
/** Omission is deliberate: no placeholder source, scope, admission or capsule. */
export function createDesktopScopedControlSources(options:Options){
 if(options.identity.scope==='unavailable')return;
 const scope=Object.freeze({...options.getScope()});
 const preparationNativeSource=createDefaultDispatchPreparationNativeSource({window:options.window,scope,isTrustedUrl:options.isTrustedUrl});
 const preparationOwner=createDefaultDispatchPreparationOwner(preparationNativeSource);
 options.registerIngress(preparationOwner.ingress);
 options.registerFinalStep({name:'default-dispatch-preparation-owner',run:()=>preparationOwner.drain()});
 const defaultDispatchController=createDefaultDispatchBusinessController({window:options.window,scope,isTrustedUrl:options.isTrustedUrl,preparationRecipient:preparationOwner});
 options.registerIngress(defaultDispatchController.ingress);
 options.registerFinalStep({name:'default-dispatch-controller',run:()=>defaultDispatchController.drain()});
 const writerSource=createKSwarmWriterControlSource({getWindow:options.getWindow,getScope:()=>scope,isTrustedUrl:options.isTrustedUrl});
 return {scope,preparationOwner,defaultDispatchController,writerSource};
}
export function desktopScopedKSwarmOptions(sources:ReturnType<typeof createDesktopScopedControlSources>){
 if(!sources)return {};
 return {desktopProjectScope:sources.scope,ownedControlAdmission:sources.writerSource.admission,ownedBusinessAdmission:sources.defaultDispatchController.businessAdmission,ownedPreparationSource:sources.preparationOwner.transportSource,ownedPreparationAdmission:sources.preparationOwner.transportAdmission};
}
