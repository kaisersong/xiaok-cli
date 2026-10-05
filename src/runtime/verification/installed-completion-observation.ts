import {readInstalledCurrentOwner} from './installed-owner-state.js';
import {createInstalledVerificationClient} from './controller-client.js';
import {openCompletionClient,openCompletionClientSync,type CurrentCompletionState} from './completion-client.js';
import type {VerificationOwner} from './proof-authority.js';
import {canonicalVerificationJson as json} from './protocol.js';
type OwnerIdentity=Pick<VerificationOwner,'ownerKind'|'ownerId'>;
export type InstalledCompletionObservation={kind:'ordinary'}|{kind:'unavailable'}|{kind:'protected';state:Readonly<CurrentCompletionState>};
function bind(state:Readonly<CurrentCompletionState>,owner:Readonly<VerificationOwner>):Readonly<InstalledCompletionObservation>{
 if(json(state.owner)!==json(owner)||state.obligationCount<1)throw Error('installed_completion_binding');
 return Object.freeze({kind:'protected',state});
}
/** Fresh display/evidence observation only. This result is never authorization to
 * write a protected completion: settlement and receiver commit remain required. */
export function observeInstalledCompletionSync(owner:OwnerIdentity):Readonly<InstalledCompletionObservation>{
 let client:ReturnType<typeof createInstalledVerificationClient>|undefined;
 try{const route=readInstalledCurrentOwner(owner);if(route.kind==='ordinary')return Object.freeze({kind:'ordinary'});if(route.kind==='unavailable'||route.kind==='pending')return Object.freeze({kind:'unavailable'});
  client=createInstalledVerificationClient();const reader=openCompletionClientSync({...owner,transport:client.completionTransport});return bind(reader.inspectSync(),route.owner);
 }catch{return Object.freeze({kind:'unavailable'});}finally{client?.dispose();}
}
export async function observeInstalledCompletion(owner:OwnerIdentity,signal?:AbortSignal):Promise<Readonly<InstalledCompletionObservation>>{
 let client:ReturnType<typeof createInstalledVerificationClient>|undefined;
 try{signal?.throwIfAborted();const route=readInstalledCurrentOwner(owner);if(route.kind==='ordinary')return Object.freeze({kind:'ordinary'});if(route.kind==='unavailable'||route.kind==='pending')return Object.freeze({kind:'unavailable'});
  client=createInstalledVerificationClient();const reader=await openCompletionClient({...owner,transport:client.completionTransport,signal}),state=await reader.inspect(signal);signal?.throwIfAborted();return bind(state,route.owner);
 }catch(error){signal?.throwIfAborted();return Object.freeze({kind:'unavailable'});}finally{client?.dispose();}
}
